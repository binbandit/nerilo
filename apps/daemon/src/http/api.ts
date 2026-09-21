import { timingSafeEqual } from "node:crypto";
import {
  readRequestText,
  RequestTooLargeError,
  SKILLS_REQUEST_LIMIT,
  GIT_REQUEST_LIMIT,
} from "@nerilo/protocol";
import { z } from "zod";
import {
  withGithubAccount,
  withTaskGithubAccount,
} from "../git/github-context";
import { handleClaudeLogin } from "../agents/claude-login";
import { handleCodexLogin } from "../agents/codex-login";
import { selectClaudeLogin, selectCodexLogin } from "../agents/credentials";
import type { Store } from "../platform/store";
import type { Engine } from "../tasks/engine";
import { handleConnectionMutation } from "./connection-routes";
import { type ApiContext, json } from "./context";
import { handleRead } from "./read-routes";
import { handleRecordMutation } from "./record-routes";
import { handleSettingsMutation } from "./settings-routes";
import { handleTaskMutation } from "./task-routes";

export function authorized(value: string | null, secret: string) {
  const candidate = Buffer.from(value ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
export function createApi(store: Store, engine: Engine, secret: string) {
  const schedule = () => {
    void engine
      .tick()
      .catch((error) =>
        console.error(
          "Scheduler:",
          error instanceof Error ? error.message : String(error),
        ),
      );
  };
  const requireTask = (id: string) => {
    const task = store.get("task", id);
    if (!task) throw new Error("Task not found.");
    return task;
  };
  const context: ApiContext = { store, engine, schedule, requireTask };
  return async (request: Request): Promise<Response> => {
    if (!authorized(request.headers.get("authorization"), secret))
      return json({ error: "Unauthorized" }, 401);
    const login = await handleClaudeLogin(request, selectClaudeLogin);
    if (login) return login;
    const codexLogin = await handleCodexLogin(request, selectCodexLogin);
    if (codexLogin) return codexLogin;
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "GET")
        return await scoped(() => handleRead(request, url, context));
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const bodyLimit =
        path === "/skills"
          ? SKILLS_REQUEST_LIMIT
          : /^\/tasks\/[^/]+\/git(?:\/draft)?$/.test(path)
            ? GIT_REQUEST_LIMIT
            : 100000;
      const raw = await readRequestText(request, bodyLimit);
      const body: unknown = raw ? JSON.parse(raw) : {};
      return await scoped(
        async () =>
          (await handleTaskMutation(path, request, body, context)) ??
          (await handleRecordMutation(path, body, context)) ??
          (await handleSettingsMutation(path, body, context)) ??
          (await handleConnectionMutation(path, body, context)) ??
          json({ error: "Not found" }, 404),
      );
    } catch (error) {
      return json(
        {
          error:
            error instanceof z.ZodError
              ? error.issues.map((i) => i.message).join(" ")
              : error instanceof Error
                ? error.message
                : "The request could not be completed.",
        },
        error instanceof RequestTooLargeError ? 413 : 400,
      );
    }
    function scoped<T>(action: () => T): T {
      const task = /^\/tasks\/([^/]+)(?:\/|$)/.exec(path);
      if (task) return withTaskGithubAccount(store, task[1], action);
      const project = /^\/projects\/([^/]+)(?:\/|$)/.exec(path);
      return withGithubAccount(
        project ? store.get("project", project[1])?.githubAccount : null,
        action,
      );
    }
  };
}
