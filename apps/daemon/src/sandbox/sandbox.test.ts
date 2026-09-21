import { test, expect } from "bun:test";
import {
  sandboxDefaults,
  sandboxSchema,
  taskSchema,
  projectSchema,
  turnSchema,
} from "@nerilo/protocol";
import { sandboxLimits } from "./sandbox";
import { Store } from "../platform/store";
import { Engine } from "../tasks/engine";
import { createApi } from "../http/api";

test("sandbox settings become bounded Docker resource limits", () => {
  expect(
    sandboxLimits({
      workspace: "read-only" as const,
      cpus: 0.5,
      memoryMB: 1024,
      pids: 128,
    }),
  ).toEqual(["--cpus", "0.5", "--memory", "1024m", "--pids-limit", "128"]);
  for (const value of [
    { ...sandboxDefaults, cpus: 0 },
    { ...sandboxDefaults, memoryMB: 0 },
    { ...sandboxDefaults, pids: 999999 },
    { ...sandboxDefaults, workspace: "host" },
  ])
    expect(sandboxSchema.safeParse(value).success).toBe(false);
});

test("sandbox overrides affect future turns while preserving the active turn's recorded limits", async () => {
  const store = new Store(":memory:");
  store.put(
    "project",
    "project",
    projectSchema.parse({
      id: "project",
      name: "Sandbox fixture",
      path: "/tmp/sandbox-fixture",
      branch: "main",
      createdAt: "now",
    }),
  );
  try {
    const api = createApi(store, new Engine(store, true), "test");
    const task = taskSchema.parse({
      id: "sandbox-task",
      projectId: "project",
      title: "Read source",
      provider: "codex",
      presetId: "programmer",
      model: "",
      status: "working",
      sessionId: null,
      baseCommit: null,
      includeChanges: false,
      pending: [],
      activeTurnId: "turn",
      createdAt: "now",
      updatedAt: "now",
      archived: false,
      error: null,
      stopRequested: false,
    });
    const turn = turnSchema.parse({
      id: "turn",
      taskId: task.id,
      inputId: "input",
      prompt: "Read source",
      status: "running",
      container: "unused",
      cursor: 0,
      startedAt: "now",
      endedAt: null,
      result: null,
      sandbox: sandboxDefaults,
    });
    store.put("task", task.id, task);
    store.put("turn", turn.id, turn);
    const post = (path: string, body: unknown) =>
      api(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: { Authorization: "Bearer test" },
          body: JSON.stringify(body),
        }),
      );
    const limited = {
      network: "internet" as const,
      workspace: "read-only" as const,
      cpus: 1,
      memoryMB: 2048,
      pids: 128,
    };
    expect(
      (await post(`/tasks/${task.id}/sandbox`, { sandbox: limited })).status,
    ).toBe(200);
    expect(store.get("task", task.id)?.sandbox).toEqual(limited);
    expect(store.get("turn", turn.id)?.sandbox).toEqual(sandboxDefaults);
    expect((await post("/sandbox-defaults", limited)).status).toBe(200);
    expect(store.get("settings", "default")?.sandbox).toEqual(limited);
    expect(
      (await post(`/tasks/${task.id}/sandbox`, { sandbox: null })).status,
    ).toBe(200);
    expect(store.get("task", task.id)?.sandbox).toBeNull();
    expect(
      (await post("/sandbox-defaults", { ...limited, cpus: -2 })).status,
    ).toBe(400);
  } finally {
    store.db.close();
  }
});
