import { expect, spyOn, test } from "bun:test";
import {
  projectSchema,
  pullRequestContextSchema,
  taskSchema,
} from "@nerilo/protocol";
import * as config from "../platform/config";
import { Store } from "../platform/store";
import { Engine } from "../tasks/engine";
import { createApi } from "./api";
import { githubCommandEnvironment } from "../git/github-context";
import { contextFixture } from "../git/pull-request-context.fixture";

test("PR task creation requires reviewed current context and creates a distinct linked workspace without changing the previous one", async () => {
  const store = new Store(":memory:");
  const project = projectSchema.parse({
    id: "project",
    name: "Repo",
    path: "",
    repository: "example/repo",
    githubAccount: { hostname: "github.com", login: "project-account" },
    branch: "main",
    createdAt: "2026-09-20T00:00:00Z",
  });
  store.put("project", project.id, project);
  const engine = new Engine(store, true);
  const tick = spyOn(engine, "tick").mockResolvedValue();
  const network = contextFixture();
  const actingLogins: string[] = [];
  const read = spyOn(config, "checked").mockImplementation(async (args) => {
    const env = await githubCommandEnvironment(args, async (command) => ({
      code: 0,
      stdout: command.at(-1)!,
      stderr: "",
    }));
    if (env) actingLogins.push(env.GH_TOKEN);
    return network.checked(args);
  });
  const api = createApi(store, engine, "fixture");
  const url = "https://github.com/example/repo/pull/4";
  const request = (path: string, body?: unknown, key = crypto.randomUUID()) =>
    api(
      new Request(`http://localhost/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: "Bearer fixture", "Idempotency-Key": key },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  const preview = async () =>
    pullRequestContextSchema.parse(
      await (
        await request(
          `projects/project/pull-requests/context?url=${encodeURIComponent(url)}&login=task-account`,
        )
      ).json(),
    );
  const input = {
    githubAccount: { hostname: "github.com", login: "task-account" },
    projectId: project.id,
    presetId: "programmer",
    prompt: "Implement the requested fixes.",
    pullRequestURL: url,
    pullRequestIntent: "address_feedback",
  };
  try {
    const context = await preview();
    network.setReview("A review arrived after the dialog opened.");
    const stale = await request("tasks", {
      ...input,
      pullRequestContextHash: context.contextHash,
    });
    expect(stale.status).toBe(400);
    expect((await stale.json()).error).toContain("Refresh the PR context");
    expect(store.all("task")).toHaveLength(0);
    const current = await preview();
    const key = crypto.randomUUID();
    const accepted = await request(
      "tasks",
      { ...input, pullRequestContextHash: current.contextHash },
      key,
    );
    expect(accepted.status).toBe(201);
    const first = taskSchema.parse(await accepted.json());
    expect(first.title).toStartWith("Address feedback #4 · workspace 1");
    expect(first.pending[0].text).toContain(
      "A review arrived after the dialog opened.",
    );
    expect(first.pending[0].text).toContain("Follow-up after the first page.");
    expect(first.source?.intent).toBe("address_feedback");
    expect(
      (
        await request(
          "tasks",
          { ...input, pullRequestContextHash: current.contextHash },
          key,
        )
      ).status,
    ).toBe(201);
    expect(store.all("task")).toHaveLength(1);
    const second = taskSchema.parse(
      await (
        await request("tasks", {
          ...input,
          pullRequestContextHash: current.contextHash,
          pullRequestPreviousTaskId: first.id,
        })
      ).json(),
    );
    expect(second.title).toStartWith("Address feedback #4 · workspace 2");
    expect(second.source?.previousTaskId).toBe(first.id);
    expect(store.get("task", first.id)).toEqual(first);
    expect(new Set(actingLogins)).toEqual(new Set(["task-account"]));
    expect(
      (await request("projects/project/pull-requests?state=bogus")).status,
    ).toBe(400);
  } finally {
    read.mockRestore();
    tick.mockRestore();
    store.db.close();
  }
});
