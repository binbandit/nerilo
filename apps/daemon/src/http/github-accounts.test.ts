import { expect, spyOn, test } from "bun:test";
import * as config from "../platform/config";
import { Store } from "../platform/store";
import { Engine } from "../tasks/engine";
import { createApi } from "./api";
import { projectSchema, taskSchema } from "@nerilo/protocol";
import {
  githubCommandEnvironment,
  taskGithubAccount,
} from "../git/github-context";
import {
  normalizePullRequest,
  refreshLinkedPullRequests,
} from "../git/pull-requests";

test("GitHub account routes require authorization and return the switched account without credentials", async () => {
  const store = new Store(":memory:");
  const api = createApi(store, new Engine(store, true), "fixture");
  let active = "personal";
  const run = spyOn(config, "command").mockImplementation(async (args) => {
    if (args[2] === "switch") active = args[6];
    return {
      code: 0,
      stderr: "",
      stdout: JSON.stringify({
        hosts: {
          "github.com": ["personal", "work"].map((login) => ({
            login,
            active: login === active,
            state: "success",
            tokenSource: "keyring",
            token: "private-token",
          })),
        },
      }),
    };
  });
  const request = (path: string, body?: unknown, authorized = true) =>
    api(
      new Request(`http://localhost${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: authorized ? { Authorization: "Bearer fixture" } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  try {
    expect(
      (await request("/connections/github", undefined, false)).status,
    ).toBe(401);
    expect(
      (
        await request(
          "/connections/github/switch",
          { hostname: "github.com", login: "work" },
          false,
        )
      ).status,
    ).toBe(401);
    expect(run).not.toHaveBeenCalled();
    const before = await request("/connections/github");
    expect(before.status).toBe(200);
    expect(await before.text()).not.toContain("private-token");
    const switched = await request("/connections/github/switch", {
      hostname: "github.com",
      login: "work",
    });
    expect(switched.status).toBe(200);
    expect((await switched.json()).hosts[0].accounts).toEqual([
      { login: "personal", active: false, state: "success" },
      { login: "work", active: true, state: "success" },
    ]);
    expect(
      (
        await request("/connections/github/switch", {
          hostname: "github.com",
          login: "unknown",
        })
      ).status,
    ).toBe(400);
    expect(active).toBe("work");
  } finally {
    run.mockRestore();
    store.db.close();
  }
});

test("project defaults and task overrides persist and scope API and background PR reads", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store, true);
  const tick = spyOn(engine, "tick").mockResolvedValue();
  const api = createApi(store, engine, "fixture");
  const account = (login: string) => ({
    hostname: "github.com" as const,
    login,
  });
  const token = async (args: string[]) => ({
    code: 0,
    stdout: args.at(-1)!,
    stderr: "",
  });
  const calls: { args: string[]; login: string }[] = [];
  const rawPR = {
    url: "https://github.com/example/repo/pull/1",
    number: 1,
    title: "Test PR",
    state: "OPEN",
    isDraft: false,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    headRefName: "feature",
    baseRefName: "main",
    statusCheckRollup: [],
  };
  const run = spyOn(config, "checked").mockImplementation(async (args) => {
    const env = await githubCommandEnvironment(args, token);
    if (env) calls.push({ args, login: env.GH_TOKEN });
    if (args[1] === "repo")
      return JSON.stringify({
        nameWithOwner: args[3],
        defaultBranchRef: { name: "main" },
        isEmpty: false,
      });
    if (args.includes("ls-remote"))
      return `${"a".repeat(40)}\trefs/heads/main\n`;
    if (args[1] === "pr")
      return JSON.stringify(args[2] === "list" ? [] : rawPR);
    return "";
  });
  const request = (path: string, body?: unknown) =>
    api(
      new Request(`http://localhost/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  try {
    const response = await request("projects", {
      name: "Repo",
      repository: "example/repo",
      githubAccount: account("work"),
    });
    expect(response.status).toBe(201);
    const project = projectSchema.parse(await response.json());
    expect(calls.map((call) => call.login)).toEqual(["work", "work"]);
    const create = async (githubAccount?: ReturnType<typeof account>) =>
      taskSchema.parse(
        await (
          await request("tasks", {
            projectId: project.id,
            presetId: "programmer",
            prompt: "Test",
            githubAccount,
          })
        ).json(),
      );
    const inherited = await create();
    const overridden = await create(account("personal"));
    expect(taskGithubAccount(store, inherited.id)).toEqual(account("work"));
    expect(taskGithubAccount(store, overridden.id)).toEqual(
      account("personal"),
    );
    expect(calls.slice(-4).map((call) => call.login)).toEqual([
      "work",
      "work",
      "personal",
      "personal",
    ]);
    await request(`projects/${project.id}/pull-requests`);
    expect(calls.at(-1)?.login).toBe("work");
    await request(`tasks/${overridden.id}/pull-requests`, { url: rawPR.url });
    expect(calls.at(-1)?.login).toBe("personal");

    const pr = {
      ...normalizePullRequest(rawPR),
      syncedAt: "1970-01-01T00:00:00.000Z",
      attemptedAt: "1970-01-01T00:00:00.000Z",
    };
    for (const task of [inherited, overridden])
      store.put("task", task.id, { ...task, pullRequests: [pr] });
    const observed: string[] = [];
    await refreshLinkedPullRequests(store, {
      observe: async () => {
        observed.push(
          (await githubCommandEnvironment(["gh", "api", "user"], token))!
            .GH_TOKEN,
        );
        throw new Error("Fixture has no detailed observation");
      },
    });
    expect(observed).toEqual(["work", "personal"]);

    expect(
      (
        await request(`projects/${project.id}`, {
          githubAccount: account("other"),
        })
      ).status,
    ).toBe(200);
    expect(taskGithubAccount(store, inherited.id)).toEqual(account("other"));
    expect(taskGithubAccount(store, overridden.id)).toEqual(
      account("personal"),
    );
    expect(
      (await request(`projects/${project.id}`, { name: "Renamed" })).status,
    ).toBe(200);
    expect(store.get("project", project.id)?.githubAccount).toEqual(
      account("other"),
    );
    expect(
      (
        await request(`tasks/${overridden.id}/github-account`, {
          githubAccount: null,
        })
      ).status,
    ).toBe(200);
    expect(taskGithubAccount(store, overridden.id)).toEqual(account("other"));
    store.put("task", inherited.id, {
      ...store.get("task", inherited.id)!,
      activeTurnId: "running",
    });
    expect(
      (
        await request(`tasks/${inherited.id}/github-account`, {
          githubAccount: account("personal"),
        })
      ).status,
    ).toBe(400);
    expect(taskGithubAccount(store, inherited.id)).toEqual(account("other"));
    expect(
      (await request(`projects/${project.id}`, { githubAccount: null })).status,
    ).toBe(200);
    expect(taskGithubAccount(store, overridden.id)).toBeNull();
    expect(
      (
        await request(`tasks/${overridden.id}/github-account`, {
          githubAccount: { hostname: "enterprise.test", login: "work" },
        })
      ).status,
    ).toBe(400);
  } finally {
    run.mockRestore();
    tick.mockRestore();
    store.db.close();
  }
});
