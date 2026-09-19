import { test, expect, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  projectSchema,
  taskSchema,
  turnSchema,
  type Runtime,
  type Task,
} from "@nerilo/protocol";
import { Store } from "./store";
import { Engine } from "./engine";
import { createApi } from "./api";
import {
  archiveProject,
  deleteProject,
  isProjectDeleting,
} from "./project-lifecycle";
import { withTaskLock } from "./task-locks";
import { tickAutonomy, configureAutonomy } from "./autonomy";
import * as models from "./models";

function fixture() {
  const store = new Store(":memory:");
  const project = projectSchema.parse({
    id: crypto.randomUUID(),
    name: "Project fixture",
    path: "/tmp/project-fixture",
    branch: "main",
    createdAt: "now",
  });
  store.put("project", project.id, project);
  const task = taskSchema.parse({
    id: crypto.randomUUID(),
    projectId: project.id,
    title: "Queued work",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "queued",
    sessionId: null,
    baseCommit: null,
    includeChanges: false,
    pending: [
      { id: "input", text: "Keep these instructions", createdAt: "now" },
    ],
    activeTurnId: null,
    createdAt: "now",
    updatedAt: "now",
    error: null,
    stopRequested: false,
    archived: false,
  });
  store.put("task", task.id, task);
  const engine = new Engine(store, true);
  const api = createApi(store, engine, "test");
  const post = (path: string, body: unknown = {}) =>
    api(
      new Request(`http://localhost/${path}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
    );
  return { store, project, task, engine, post };
}
function seedAutonomy(store: Store, taskId: string) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS task_autonomy(taskId TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  const state = {
    taskId,
    mode: "pr",
    status: "reviewing",
    repository: "example/project",
    base: "main",
    branch: "nerilo/fixture",
    prUrl: "https://github.com/example/project/pull/1",
    detail: "Waiting",
    repairTurns: 0,
    updatedAt: "now",
    workingPath: null,
    publishedHead: "a".repeat(40),
    processedTurnId: null,
    cursor: null,
    ignoredEventIds: [],
    awaitingReply: [],
    rebaseTarget: null,
    mergeAfter: null,
    lastDecision: "",
    failures: 0,
    retryAfter: null,
  };
  store.db
    .query("INSERT INTO task_autonomy VALUES(?,?)")
    .run(taskId, JSON.stringify(state));
  return state;
}
const readyRuntime: Runtime = {
  docker: true,
  image: true,
  building: false,
  buildLog: "",
  connections: {
    codex: {
      ready: true,
      source: "fixture",
      canImport: false,
      canImportGateway: false,
      mode: "direct",
    },
    claude: {
      ready: false,
      source: "none",
      canImport: false,
      canImportGateway: false,
      mode: "direct",
    },
  },
};

test("project archive defaults migrate legacy records and restoration retains paused work and history", async () => {
  const f = fixture();
  try {
    const legacy = { ...f.project };
    Reflect.deleteProperty(legacy, "archived");
    f.store.db
      .query("UPDATE records SET data=? WHERE kind='project' AND id=?")
      .run(JSON.stringify(legacy), f.project.id);
    expect(f.store.get("project", f.project.id)?.archived).toBe(false);
    const hidden = {
      ...f.task,
      id: crypto.randomUUID(),
      archived: true,
      status: "ready" as const,
      pending: [],
    };
    f.store.put("task", hidden.id, hidden);
    const auto = { ...hidden, id: crypto.randomUUID(), archived: false };
    f.store.put("task", auto.id, auto);
    const autonomy = seedAutonomy(f.store, auto.id);
    f.store.put("note", "note", {
      id: "note",
      projectId: f.project.id,
      title: "Context",
      content: "Keep me",
      updatedAt: "now",
    });
    f.store.event({
      taskId: f.task.id,
      turnId: null,
      kind: "user",
      text: "History",
    });
    f.store.put(
      "turn",
      "turn",
      turnSchema.parse({
        id: "turn",
        taskId: f.task.id,
        inputId: "old",
        prompt: "Earlier",
        status: "finished",
        container: "fixture",
        cursor: 0,
        startedAt: "now",
        endedAt: "now",
        result: null,
      }),
    );
    expect(
      (await f.post(`projects/${f.project.id}/archive`, { archived: true }))
        .status,
    ).toBe(200);
    expect(f.store.get("task", f.task.id)).toMatchObject({
      status: "paused",
      pending: f.task.pending,
      archived: false,
    });
    expect(f.store.get("task", hidden.id)).toEqual(hidden);
    expect(f.store.get("task", auto.id)?.status).toBe("paused");
    expect(f.store.get("turn", "turn")?.prompt).toBe("Earlier");
    expect(f.store.events(f.task.id)[0]?.text).toBe("History");
    expect(f.store.get("note", "note")?.content).toBe("Keep me");
    expect(
      (await f.post(`projects/${f.project.id}/archive`, { archived: false }))
        .status,
    ).toBe(200);
    expect(f.store.get("project", f.project.id)?.archived).toBe(false);
    expect(f.store.get("task", auto.id)?.status).toBe("paused");
    expect(f.store.get("task", f.task.id)?.status).toBe("paused");
    expect(
      JSON.parse(
        f.store.db
          .query<{ data: string }, [string]>(
            "SELECT data FROM task_autonomy WHERE taskId=?",
          )
          .get(auto.id)!.data,
      ),
    ).toEqual(autonomy);
  } finally {
    f.store.db.close();
  }
});

test("archive rejects active agents and in-flight workspace actions without changing records", async () => {
  const f = fixture();
  const run = async () => {
    throw new Error("Should not touch Docker");
  };
  try {
    const active = {
      ...f.task,
      status: "working" as const,
      activeTurnId: "active",
    };
    f.store.put("task", active.id, active);
    expect(() => archiveProject(f.store, f.project.id, true)).toThrow(
      "Pause running agents",
    );
    await expect(deleteProject(f.store, f.project.id, run)).rejects.toThrow(
      "Pause running agents",
    );
    expect(f.store.get("project", f.project.id)?.archived).toBe(false);
    expect(f.store.get("task", active.id)).toEqual(active);
    f.store.put("task", f.task.id, f.task);
    await withTaskLock(f.task.id, async () => {
      expect(() => archiveProject(f.store, f.project.id, true)).toThrow(
        "Git actions",
      );
      await expect(deleteProject(f.store, f.project.id, run)).rejects.toThrow(
        "Git actions",
      );
    });
    expect(f.store.get("project", f.project.id)).toEqual(f.project);
    expect(f.store.get("task", f.task.id)).toEqual(f.task);
  } finally {
    f.store.db.close();
  }
});

test("archived projects block queued starts, Autopilot and mutations, while allowing read and cancellation", async () => {
  const f = fixture();
  const runtime = Promise.withResolvers<Runtime>();
  const runtimeSpy = spyOn(f.engine, "runtime").mockReturnValue(
    runtime.promise,
  );
  const launch = spyOn(
    f.engine as unknown as { launch(task: Task): Promise<void> },
    "launch",
  ).mockResolvedValue();
  try {
    seedAutonomy(f.store, f.task.id);
    const tick = f.engine.tick();
    archiveProject(f.store, f.project.id, true);
    runtime.resolve(readyRuntime);
    await tick;
    expect(launch).not.toHaveBeenCalled();
    f.store.put("task", f.task.id, { ...f.task, status: "queued" });
    runtimeSpy.mockClear();
    await f.engine.tick();
    expect(runtimeSpy).not.toHaveBeenCalled();
    f.store.put("task", f.task.id, { ...f.task, status: "ready", pending: [] });
    let observations = 0;
    await tickAutonomy(f.store, f.engine, {
      observe: async () => {
        observations++;
        throw new Error("Should not observe");
      },
    });
    expect(observations).toBe(0);
    await expect(
      configureAutonomy(f.store, f.task.id, { mode: "pr" }),
    ).rejects.toThrow("Restore this project");
    for (const [operation, body] of [
      ["follow-up", { text: "New" }],
      ["retry", {}],
      ["git", { action: "push" }],
      ["git/draft", {}],
      ["queue", { action: "promote", inputId: "input" }],
    ] as const) {
      const response = await f.post(`tasks/${f.task.id}/${operation}`, body);
      expect(response.status).toBe(400);
      expect(await response.text()).toContain("Restore this project");
    }
    expect(
      (
        await f.post("tasks", {
          projectId: f.project.id,
          presetId: "programmer",
          prompt: "New task",
        })
      ).status,
    ).toBe(400);
    expect(
      (await f.post(`projects/${f.project.id}`, { remove: true })).status,
    ).toBe(400);
    f.store.put("task", f.task.id, { ...f.task, status: "paused" });
    expect(
      (
        await f.post(`tasks/${f.task.id}/queue`, {
          action: "remove",
          inputId: "input",
          expectedText: "Keep these instructions",
        })
      ).status,
    ).toBe(200);
    const api = createApi(f.store, f.engine, "test");
    expect(
      (
        await api(
          new Request(`http://localhost/tasks/${f.task.id}`, {
            headers: { Authorization: "Bearer test" },
          }),
        )
      ).status,
    ).toBe(200);
  } finally {
    launch.mockRestore();
    runtimeSpy.mockRestore();
    f.store.db.close();
  }
});

test("project deletion is scoped, retryable after partial cleanup, and retains local repositories and exports", async () => {
  const f = fixture();
  const root = await mkdtemp(join(tmpdir(), "nerilo-project-lifecycle-"));
  const repository = join(root, "repo.txt"),
    exported = join(root, "export.txt");
  await Bun.write(repository, "source");
  await Bun.write(exported, "export");
  const second = {
    ...f.task,
    id: crypto.randomUUID(),
    status: "paused" as const,
    checkout: { path: exported, turnId: "turn", createdAt: "now" },
  };
  const otherProject = { ...f.project, id: crypto.randomUUID() };
  const other = {
    ...second,
    id: crypto.randomUUID(),
    projectId: otherProject.id,
  };
  f.store.put("project", f.project.id, { ...f.project, path: repository });
  f.store.put("project", otherProject.id, otherProject);
  f.store.put("task", second.id, second);
  f.store.put("task", other.id, other);
  f.store.put("note", "scoped", {
    id: "scoped",
    projectId: f.project.id,
    title: "Scoped",
    content: "remove",
    updatedAt: "now",
  });
  f.store.put("note", "global", {
    id: "global",
    projectId: null,
    title: "Global",
    content: "keep",
    updatedAt: "now",
  });
  const settings = f.store.get("settings", "default")!;
  f.store.put("settings", "default", {
    ...settings,
    sidebarOrder: {
      projects: [f.project.id, otherProject.id],
      tasks: {
        [f.project.id]: [f.task.id, second.id],
        [otherProject.id]: [other.id],
      },
    },
  });
  f.store.command("task-cache", () => f.task);
  f.store.command("project-cache", () => f.project);
  const calls: string[][] = [];
  let fail = true;
  const run = async (args: string[]) => {
    calls.push(args);
    if (
      args.includes("ps") &&
      args.includes(`label=dev.nerilo.task=${second.id}`) &&
      fail
    )
      throw new Error("Docker unavailable");
    if (args.includes("volume") && args.includes("ls"))
      return `nerilo-work-${f.task.id}\nnerilo-work-${second.id}\nnerilo-work-${other.id}`;
    return "";
  };
  try {
    await expect(deleteProject(f.store, f.project.id, run)).rejects.toThrow(
      "Docker unavailable",
    );
    expect(f.store.get("project", f.project.id)?.archived).toBe(true);
    expect(f.store.get("task", f.task.id)).toBeNull();
    expect(f.store.get("task", second.id)?.projectId).toBe(f.project.id);
    expect(f.store.get("note", "scoped")).not.toBeNull();
    fail = false;
    await deleteProject(f.store, f.project.id, run);
    expect(f.store.get("project", f.project.id)).toBeNull();
    expect(f.store.get("task", second.id)).toBeNull();
    expect(f.store.get("note", "scoped")).toBeNull();
    expect(f.store.get("task", other.id)).toEqual(other);
    expect(f.store.get("note", "global")?.content).toBe("keep");
    expect(f.store.get("settings", "default")?.sidebarOrder).toEqual({
      projects: [otherProject.id],
      tasks: { [otherProject.id]: [other.id] },
    });
    expect(f.store.commandResult("task-cache")).toBeNull();
    expect(f.store.commandResult("project-cache")).toBeNull();
    expect(calls.some((args) => args.includes(`nerilo-work-${other.id}`))).toBe(
      false,
    );
    expect(await Bun.file(repository).text()).toBe("source");
    expect(await Bun.file(exported).text()).toBe("export");
  } finally {
    f.store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("deletion closes mutation and restoration races, while empty projects need no Docker", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let first = true;
  const run = async () => {
    if (first) {
      first = false;
      entered.resolve();
      await release.promise;
    }
    return "";
  };
  try {
    const deleting = deleteProject(f.store, f.project.id, run);
    await entered.promise;
    expect(isProjectDeleting(f.project.id)).toBe(true);
    expect(f.store.get("project", f.project.id)?.archived).toBe(true);
    expect(() => archiveProject(f.store, f.project.id, false)).toThrow(
      "being deleted",
    );
    expect(
      (await f.post(`tasks/${f.task.id}/follow-up`, { text: "Race" })).status,
    ).toBe(400);
    expect(
      (await f.post(`tasks/${f.task.id}/archive`, { archived: false })).status,
    ).toBe(400);
    expect(
      (
        await f.post("tasks", {
          projectId: f.project.id,
          presetId: "programmer",
          prompt: "Race",
        })
      ).status,
    ).toBe(400);
    release.resolve();
    await deleting;
    expect(isProjectDeleting(f.project.id)).toBe(false);
    f.store.put("project", f.project.id, f.project);
    let calls = 0;
    await deleteProject(f.store, f.project.id, async () => {
      calls++;
      throw new Error("Docker down");
    });
    expect(calls).toBe(0);
    expect(f.store.get("project", f.project.id)).toBeNull();
  } finally {
    release.resolve();
    f.store.db.close();
  }
});

test("task creation rechecks the project after asynchronous validation", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const validate = spyOn(models, "validateExecution").mockImplementation(
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  const tick = spyOn(f.engine, "tick").mockResolvedValue();
  try {
    const request = f.post("tasks", {
      projectId: f.project.id,
      presetId: "programmer",
      prompt: "Do not create after archiving",
      execution: { provider: "codex", model: "", effort: "" },
    });
    await entered.promise;
    archiveProject(f.store, f.project.id, true);
    release.resolve();
    const response = await request;
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Restore this project");
    expect(f.store.all("task")).toHaveLength(1);
    expect(tick).not.toHaveBeenCalled();
  } finally {
    release.resolve();
    validate.mockRestore();
    tick.mockRestore();
    f.store.db.close();
  }
});

test("API export holds a task lock so project archive cannot race it", async () => {
  const f = fixture();
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  const checkout = spyOn(f.engine, "checkout").mockImplementation(async () => {
    entered.resolve();
    await release.promise;
    return { path: "/tmp/retained-export", turnId: "turn", createdAt: "now" };
  });
  try {
    const request = f.post(`tasks/${f.task.id}/checkout`, { turnId: "turn" });
    await entered.promise;
    expect(() => archiveProject(f.store, f.project.id, true)).toThrow(
      "Git actions",
    );
    expect(f.store.get("project", f.project.id)?.archived).toBe(false);
    release.resolve();
    expect((await request).status).toBe(200);
    archiveProject(f.store, f.project.id, true);
    expect(
      (await f.post(`tasks/${f.task.id}/checkout`, { turnId: "turn" })).status,
    ).toBe(200);
  } finally {
    release.resolve();
    checkout.mockRestore();
    f.store.db.close();
  }
});
