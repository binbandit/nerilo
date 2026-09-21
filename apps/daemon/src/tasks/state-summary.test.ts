import { afterEach, expect, test } from "bun:test";
import { projectSchema, taskSchema, turnSchema } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { StateSummaryService, readStateSummary } from "./state-summary";
import { Engine } from "./engine";
import { createApi } from "../http/api";
import { captureRepositoryAction } from "../git/repository-history";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function fixture() {
  const store = new Store(":memory:");
  stores.push(store);
  const task = taskSchema.parse({
    id: "task",
    projectId: "project",
    title: "Improve validation",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "working",
    sessionId: "session",
    baseCommit: "base",
    includeChanges: false,
    pending: [],
    activeTurnId: "turn",
    createdAt: "before",
    updatedAt: "before",
    archived: false,
    error: null,
    stopRequested: false,
  });
  const turn = turnSchema.parse({
    id: "turn",
    taskId: task.id,
    inputId: "input",
    prompt: "Improve folder validation",
    status: "running",
    container: "container",
    cursor: 3,
    startedAt: "before",
    endedAt: null,
    result: null,
  });
  store.put("task", task.id, task);
  store.put("turn", turn.id, turn);
  store.event({
    taskId: task.id,
    turnId: turn.id,
    kind: "activity",
    text: "Reading the validation tests",
  });
  return { store, task, turn };
}
test("state summaries use current evidence, stay separate from task content and throttle repeated pulses", async () => {
  const { store, task, turn } = fixture();
  let calls = 0;
  const service = new StateSummaryService(
    store,
    async (_provider, _model, context) => {
      calls++;
      expect(context).toContain("Reading the validation tests");
      return { summary: "Inspecting folder validation and its tests." };
    },
  );
  await service.refresh(task.id);
  await service.refresh(task.id);
  await service.refresh(task.id, true);
  expect(calls).toBe(1);
  expect(readStateSummary(store, task.id)).toEqual({
    text: "Inspecting folder validation and its tests.",
    turnId: turn.id,
  });
  expect(store.get("task", task.id)).toEqual(task);
  expect(store.get("turn", turn.id)).toEqual(turn);
});

test("an in-flight active summary cannot overwrite a completed state and completion runs once afterward", async () => {
  const { store, task, turn } = fixture();
  const first = Promise.withResolvers<{ summary: string }>();
  let calls = 0;
  const service = new StateSummaryService(store, async () =>
    ++calls === 1
      ? first.promise
      : { summary: "Validation improved; all five checks passed." },
  );
  const running = service.refresh(task.id);
  store.put("task", task.id, { ...task, status: "ready", activeTurnId: null });
  store.put("turn", turn.id, { ...turn, status: "finished" });
  void service.refresh(task.id, true);
  first.resolve({ summary: "Inspecting the implementation." });
  await running;
  await service.refresh(task.id, true);
  expect(calls).toBe(2);
  expect(readStateSummary(store, task.id).text).toBe(
    "Validation improved; all five checks passed.",
  );
});

test("new turns hide old state summaries and discard late results for previous turns", async () => {
  const { store, task, turn } = fixture();
  const delayed = Promise.withResolvers<{ summary: string }>();
  const service = new StateSummaryService(store, async () => delayed.promise);
  const running = service.refresh(task.id);
  store.put("turn", "next", { ...turn, id: "next", prompt: "A new request" });
  delayed.resolve({ summary: "Old request finished." });
  await running;
  expect(readStateSummary(store, task.id)).toEqual({
    text: null,
    turnId: "next",
  });
});

test("marking a task complete hides its saved summary without inference on read", async () => {
  const { store, task } = fixture();
  store.put(
    "project",
    task.projectId,
    projectSchema.parse({
      id: task.projectId,
      name: "Fixture",
      path: "/unused",
      branch: "main",
      createdAt: "before",
    }),
  );
  store.put("task", task.id, {
    ...task,
    status: "ready",
    activeTurnId: null,
  });
  let calls = 0;
  const service = new StateSummaryService(store, async () => {
    calls++;
    return { summary: "The task is ready and awaiting review." };
  });
  await service.refresh(task.id);
  expect(readStateSummary(store, task.id).text).toContain("awaiting review");
  const engine = new Engine(store, true);
  const api = createApi(store, engine, "fixture");
  const response = await api(
    new Request(`http://localhost/tasks/${task.id}/complete`, {
      method: "POST",
      headers: { Authorization: "Bearer fixture" },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
  await engine.tick();
  const summary = await api(
    new Request(`http://localhost/tasks/${task.id}/state-summary`, {
      headers: { Authorization: "Bearer fixture" },
    }),
  );
  expect(store.get("task", task.id)?.status).toBe("complete");
  expect(await summary.json()).toEqual({ text: null, turnId: "turn" });
  expect(calls).toBe(1);
});

test("publication and review changes hide stale saved summaries without inference on read", async () => {
  const { store, task } = fixture();
  let calls = 0;
  const service = new StateSummaryService(
    store,
    async (_provider, _model, context) => {
      calls++;
      return {
        summary: context.includes("Pushed feature branch")
          ? "Changes are published."
          : "Nothing has been published.",
      };
    },
  );
  await service.refresh(task.id);
  expect(readStateSummary(store, task.id).text).toBe(
    "Nothing has been published.",
  );
  captureRepositoryAction(store, task.id, {
    id: "push:head",
    kind: "published",
    summary: "Pushed feature branch",
    headSha: "head",
  });
  expect(readStateSummary(store, task.id).text).toBeNull();
  expect(calls).toBe(1);
  await service.refresh(task.id, true);
  expect(readStateSummary(store, task.id).text).toBe("Changes are published.");
  saveAutonomy(store, "reviewing", "Waiting for approval.");
  expect(readStateSummary(store, task.id).text).toBeNull();
  expect(calls).toBe(2);
});

test("identical evidence from a new turn still gets a current summary", async () => {
  const { store, task, turn } = fixture();
  const service = new StateSummaryService(store, async () => ({
    summary: "Inspecting folder validation.",
  }));
  await service.refresh(task.id, true);
  store.put("turn", "next", { ...turn, id: "next" });
  store.event({
    taskId: task.id,
    turnId: "next",
    kind: "activity",
    text: "Reading the validation tests",
  });
  await service.refresh(task.id, true);
  expect(readStateSummary(store, task.id)).toEqual({
    text: "Inspecting folder validation.",
    turnId: "next",
  });
});

test("unavailable inference and invalid output never fail the task or create unsupported state text", async () => {
  const { store, task } = fixture();
  await new StateSummaryService(store, async () => {
    throw new Error("Unavailable");
  }).refresh(task.id);
  await new StateSummaryService(store, async () => ({
    summary: "Invented\nsecond line",
  })).refresh(task.id);
  expect(readStateSummary(store, task.id).text).toBeNull();
  expect(store.get("task", task.id)).toEqual(task);
});

test("legacy summaries without a recorded task state are hidden until refreshed", async () => {
  const { store, task } = fixture();
  store.db.exec(
    "CREATE TABLE task_state_summary(taskId TEXT PRIMARY KEY, turnId TEXT NOT NULL, text TEXT NOT NULL, fingerprint TEXT NOT NULL)",
  );
  store.db
    .query("INSERT INTO task_state_summary VALUES(?,?,?,?)")
    .run(task.id, "turn", "Old task state.", "old-fingerprint");
  expect(readStateSummary(store, task.id).text).toBeNull();
  await new StateSummaryService(store, async () => ({
    summary: "Inspecting folder validation.",
  })).refresh(task.id);
  expect(readStateSummary(store, task.id).text).toBe(
    "Inspecting folder validation.",
  );
});

function saveAutonomy(
  store: Store,
  status: "reviewing" | "merged",
  detail: string,
) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS task_autonomy(taskId TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  store.db
    .query(
      "INSERT INTO task_autonomy VALUES(?,?) ON CONFLICT(taskId) DO UPDATE SET data=excluded.data",
    )
    .run(
      "task",
      JSON.stringify({
        taskId: "task",
        mode: "merge",
        status,
        detail,
        prUrl: "https://github.com/example/repo/pull/12",
        branch: "nerilo/task",
        base: "main",
        repairTurns: 1,
        updatedAt: "now",
        privatePublicationData: "must-not-be-summarized",
      }),
    );
}

test("an Autopilot detail change rejects an old summary and receives a trailing throttled refresh", async () => {
  const { store, task } = fixture();
  saveAutonomy(store, "reviewing", "Waiting for CI.");
  const first = Promise.withResolvers<{ summary: string }>();
  const updated = Promise.withResolvers<void>();
  let calls = 0;
  const service = new StateSummaryService(
    store,
    async (_provider, _model, context) => {
      calls++;
      expect(context).toContain("https://github.com/example/repo/pull/12");
      expect(context).not.toContain("must-not-be-summarized");
      if (calls === 1) return first.promise;
      expect(context).toContain("CI passed. Waiting for approval.");
      updated.resolve();
      return { summary: "Checks passed; waiting for PR approval." };
    },
    10,
  );
  const running = service.refresh(task.id);
  saveAutonomy(store, "reviewing", "CI passed. Waiting for approval.");
  void service.refresh(task.id);
  first.resolve({ summary: "Waiting for CI." });
  await running;
  expect(readStateSummary(store, task.id).text).toBeNull();
  await updated.promise;
  await service.refresh(task.id);
  expect(readStateSummary(store, task.id).text).toBe(
    "Checks passed; waiting for PR approval.",
  );
  expect(calls).toBe(2);
});

test("a merged Autopilot result bypasses throttling and unchanged reads do not generate summaries", async () => {
  const { store, task } = fixture();
  saveAutonomy(store, "reviewing", "Waiting for CI.");
  let calls = 0;
  const service = new StateSummaryService(
    store,
    async (_provider, _model, context) => {
      calls++;
      return {
        summary: context.includes('"status":"merged"')
          ? "The PR was merged."
          : "Waiting for CI.",
      };
    },
  );
  expect(readStateSummary(store, task.id).text).toBeNull();
  expect(calls).toBe(0);
  await service.refresh(task.id);
  saveAutonomy(store, "merged", "Pull request merged.");
  await service.refresh(task.id, true);
  expect(readStateSummary(store, task.id).text).toBe("The PR was merged.");
  expect(calls).toBe(2);
});
