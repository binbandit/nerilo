import { test, expect } from "bun:test";
import { Store } from "./store";
import { authorized } from "./api";
import { taskSchema, turnSchema } from "@nerilo/protocol";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("command acceptance is idempotent and rolled back on failure", () => {
  const store = new Store(":memory:");
  let executions = 0;
  const create = () => {
    executions++;
    store.event({ taskId: "one", turnId: null, kind: "user", text: "Hello" });
    return { id: "one" };
  };
  expect(store.command("unique", create)).toEqual({ id: "one" });
  expect(store.command("unique", create)).toEqual({ id: "one" });
  expect(executions).toBe(1);
  expect(store.events("one")).toHaveLength(1);
  expect(() =>
    store.command("fails", () => {
      store.event({
        taskId: "one",
        turnId: null,
        kind: "user",
        text: "Not committed",
      });
      throw new Error("Interrupted");
    }),
  ).toThrow();
  expect(store.events("one")).toHaveLength(1);
  store.db.close();
});
test("events have stable monotonic replay cursors", () => {
  const store = new Store(":memory:");
  const one = store.event({
    taskId: "task",
    turnId: "first",
    kind: "activity",
    text: "Preparing",
  });
  const two = store.event({
    taskId: "task",
    turnId: "second",
    kind: "assistant",
    text: "Ready",
  });
  expect(two).toBeGreaterThan(one);
  expect(store.events("task").map((e) => e.seq)).toEqual([one, two]);
  expect(store.sequence()).toBe(two);
  store.db.close();
});
test("daemon rejects missing or incorrect bearer credentials", () => {
  expect(authorized(null, "secret")).toBe(false);
  expect(authorized("Bearer other", "secret")).toBe(false);
  expect(authorized("Bearer secret", "secret")).toBe(true);
});

test("legacy check failures retain results while restoring successful agent completion", () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-migration-"));
  const path = join(directory, "data.sqlite");
  let store = new Store(path);
  try {
    const task = taskSchema.parse({
      id: "task",
      projectId: "project",
      title: "Say hi",
      provider: "codex",
      presetId: "programmer",
      model: "",
      status: "failed",
      sessionId: null,
      baseCommit: null,
      includeChanges: false,
      pending: [],
      activeTurnId: null,
      createdAt: "then",
      updatedAt: "then",
      archived: false,
      error: "Verification failed. Review the output or send a follow-up.",
      stopRequested: false,
    });
    const turn = turnSchema.parse({
      id: "turn",
      taskId: task.id,
      inputId: "input",
      prompt: "Say hi",
      status: "failed",
      container: "container",
      cursor: 1,
      startedAt: "then",
      endedAt: "then",
      result: {
        exitCode: 0,
        sessionId: null,
        summary: "Hi!",
        diff: "",
        changes: [],
        verification: { command: "exit 7", exitCode: 7, output: "" },
        baseCommit: "base",
        headCommit: "base",
      },
    });
    store.put("task", task.id, task);
    store.put("turn", turn.id, turn);
    store.put("task", "agent-failure", {
      ...task,
      id: "agent-failure",
      error: "Connection is missing.",
    });
    store.put("turn", "older-check", {
      ...turn,
      id: "older-check",
      taskId: "agent-failure",
    });
    store.db.exec("PRAGMA user_version=1");
    store.db.close();
    store = new Store(path);
    expect(store.get("task", task.id)?.status).toBe("check_failed");
    expect(store.get("task", task.id)?.error).toBeNull();
    expect(store.get("turn", turn.id)?.status).toBe("finished");
    expect(store.get("turn", turn.id)?.result).toEqual(turn.result);
    expect(store.get("task", "agent-failure")?.status).toBe("failed");
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
