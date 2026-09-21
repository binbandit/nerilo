import { afterEach, expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  taskSchema,
  projectSchema,
  turnSchema,
  requestLabel,
  type Runtime,
  type Task,
} from "@nerilo/protocol";
import { Store } from "../platform/store";
import { Engine } from "./engine";
import { createApi } from "../http/api";
import { dueInput } from "./queue-actions";
import { githubCommandEnvironment } from "../git/github-context";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function fixture(path = ":memory:") {
  const store = new Store(path);
  stores.push(store);
  store.put(
    "project",
    "project",
    projectSchema.parse({
      id: "project",
      name: "Queue fixture",
      path: "/tmp/queue-fixture",
      branch: "main",
      createdAt: "before",
    }),
  );
  const task = taskSchema.parse({
    id: "task",
    projectId: "project",
    title: "Task",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "working",
    sessionId: "session",
    baseCommit: "base",
    includeChanges: false,
    pending: [
      { id: "a", text: "First message", createdAt: "a" },
      { id: "b", text: "Second message", createdAt: "b" },
    ],
    activeTurnId: "current",
    createdAt: "before",
    updatedAt: "before",
    archived: false,
    error: null,
    stopRequested: true,
  });
  const turn = turnSchema.parse({
    id: "current",
    taskId: task.id,
    inputId: "consumed",
    prompt: "Do current work",
    status: "running",
    container: "container",
    cursor: 17,
    startedAt: "before",
    endedAt: null,
    result: null,
  });
  store.put("task", task.id, task);
  store.put("turn", turn.id, turn);
  const engine = new Engine(store, true);
  const api = createApi(store, engine, "test");
  const post = (body: unknown, key?: string, authorization = "Bearer test") =>
    api(
      new Request("http://localhost/tasks/task/queue", {
        method: "POST",
        headers: { authorization, ...(key ? { "Idempotency-Key": key } : {}) },
        body: JSON.stringify(body),
      }),
    );
  return { store, task, turn, engine, post };
}

test("authenticated queue edits, promotion and removal preserve the active turn and execution", async () => {
  const { store, task, turn, engine, post } = fixture();
  const tick = spyOn(engine, "tick").mockResolvedValue();
  const edited = await post({
    action: "edit",
    inputId: "b",
    text: "  Revised request  ",
    expectedText: "Second message",
  });
  expect(edited.status).toBe(200);
  expect(taskSchema.parse(await edited.json()).pending[1].text).toBe(
    "Revised request",
  );
  await post({ action: "promote", inputId: "b" });
  expect(store.get("task", task.id)?.pending.map((item) => item.id)).toEqual([
    "b",
    "a",
  ]);
  await post({ action: "remove", inputId: "a", expectedText: "First message" });
  const current = store.get("task", task.id)!;
  expect(current).toEqual({
    ...task,
    pending: [{ ...task.pending[1], text: "Revised request" }],
    updatedAt: current.updatedAt,
  });
  expect(store.get("turn", turn.id)).toEqual(turn);
  expect(store.events(task.id)[0]).toMatchObject({
    kind: "user",
    text: "Queued message edited:\nRevised request",
  });
  expect(tick).not.toHaveBeenCalled();
});

test("stale edits and removals, consumed inputs, invalid text and missing authorization cannot mutate the queue", async () => {
  const { store, task, post } = fixture();
  for (const body of [
    { action: "edit", inputId: "a", expectedText: "outdated", text: "Wrong" },
    { action: "remove", inputId: "a", expectedText: "outdated" },
    { action: "promote", inputId: "consumed" },
    {
      action: "edit",
      inputId: "consumed",
      expectedText: "Do current work",
      text: "Wrong",
    },
    { action: "edit", inputId: "a", expectedText: "First message", text: "  " },
    {
      action: "edit",
      inputId: "a",
      expectedText: "First message",
      text: "a".repeat(30001),
    },
  ])
    expect((await post(body)).status).toBe(400);
  expect(
    (await post({ action: "promote", inputId: "b" }, undefined, "")).status,
  ).toBe(401);
  expect(store.get("task", task.id)).toEqual(task);
  expect(store.events(task.id)).toHaveLength(0);
});

test("removing the last waiting message pauses queued tasks without resuming paused or archived work", async () => {
  const { store, task, post } = fixture();
  store.put("task", task.id, {
    ...task,
    activeTurnId: null,
    status: "queued",
    pending: [task.pending[0]],
  });
  await post({ action: "remove", inputId: "a", expectedText: "First message" });
  expect(store.get("task", task.id)?.status).toBe("paused");
  store.put("task", task.id, { ...task, activeTurnId: null, status: "paused" });
  await post({ action: "promote", inputId: "b" });
  expect(store.get("task", task.id)?.status).toBe("paused");
  const archived = { ...task, archived: true };
  store.put("task", task.id, archived);
  expect((await post({ action: "promote", inputId: "b" })).status).toBe(400);
  expect(store.get("task", task.id)).toEqual(archived);
});

test("an accepted queue operation can be safely retried and survives reopening the store", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-queue-"));
  try {
    const path = join(directory, "test.sqlite");
    const { store, task, post } = fixture(path);
    const body = {
      action: "edit",
      inputId: "a",
      expectedText: "First message",
      text: "Updated",
    };
    const key = crypto.randomUUID();
    const first = await (await post(body, key)).json();
    const retry = await (await post(body, key)).json();
    expect(retry).toEqual(first);
    expect(store.events(task.id)).toHaveLength(1);
    store.db.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new Store(path);
    try {
      expect(reopened.get("task", task.id)?.pending[0].text).toBe("Updated");
      expect(reopened.events(task.id)[0].text).toContain("Updated");
    } finally {
      reopened.db.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

const readyRuntime: Runtime = {
  docker: true,
  image: true,
  building: false,
  buildLog: "",
  connections: {
    opencode: {
      ready: false,
      source: "",
      canImport: false,
      canImportGateway: false,
      mode: "direct",
    },
    pi: {
      ready: false,
      source: "",
      canImport: false,
      canImportGateway: false,
      mode: "direct",
    },
    codex: {
      ready: true,
      source: "fixture",
      canImport: false,
      canImportGateway: false,
      mode: "direct",
    },
    claude: {
      ready: true,
      source: "fixture",
      canImport: false,
      canImportGateway: false,
      mode: "direct",
    },
  },
};
test("the scheduler launches the latest edited and promoted queue after its runtime check returns", async () => {
  const { store, task, engine, post } = fixture();
  store.put("task", task.id, { ...task, activeTurnId: null, status: "queued" });
  const runtime = Promise.withResolvers<Runtime>();
  spyOn(engine, "runtime").mockReturnValue(runtime.promise);
  const launch = spyOn(
    engine as unknown as { launch(task: Task): Promise<void> },
    "launch",
  ).mockResolvedValue();
  const tick = engine.tick();
  await post({
    action: "edit",
    inputId: "b",
    expectedText: "Second message",
    text: "Edited while checking runtime",
  });
  await post({ action: "promote", inputId: "b" });
  runtime.resolve(readyRuntime);
  await tick;
  expect(launch).toHaveBeenCalledTimes(1);
  expect(launch.mock.calls[0][0].pending[0]).toMatchObject({
    id: "b",
    text: "Edited while checking runtime",
  });
});

test("the scheduler launches inherited and overridden GitHub identities in separate scopes", async () => {
  const { store, task, engine } = fixture();
  store.put("project", "project", {
    ...store.get("project", "project")!,
    githubAccount: { hostname: "github.com", login: "work" },
  });
  store.put("task", task.id, { ...task, activeTurnId: null, status: "queued" });
  store.put("task", "personal-task", {
    ...task,
    id: "personal-task",
    activeTurnId: null,
    status: "queued",
    githubAccount: { hostname: "github.com", login: "personal" },
  });
  const done = Promise.withResolvers<void>();
  const identities: Record<string, string> = {};
  const runtime = spyOn(engine, "runtime").mockResolvedValue(readyRuntime);
  const launch = spyOn(
    engine as unknown as { launch(task: Task): Promise<void> },
    "launch",
  ).mockImplementation(async (started) => {
    const env = await githubCommandEnvironment(
      ["gh", "api", "user"],
      async (args) => ({ code: 0, stdout: args.at(-1)!, stderr: "" }),
    );
    identities[started.id] = env!.GH_TOKEN;
    if (Object.keys(identities).length === 2) done.resolve();
  });
  try {
    await engine.tick();
    await done.promise;
    expect(identities).toEqual({ task: "work", "personal-task": "personal" });
  } finally {
    launch.mockRestore();
    runtime.mockRestore();
  }
});

test("a removed last input is not launched after an in-flight runtime check", async () => {
  const { store, task, engine, post } = fixture();
  store.put("task", task.id, {
    ...task,
    activeTurnId: null,
    status: "queued",
    pending: [task.pending[0]],
  });
  const runtime = Promise.withResolvers<Runtime>();
  spyOn(engine, "runtime").mockReturnValue(runtime.promise);
  const launch = spyOn(
    engine as unknown as { launch(task: Task): Promise<void> },
    "launch",
  ).mockResolvedValue();
  const tick = engine.tick();
  await post({ action: "remove", inputId: "a", expectedText: "First message" });
  runtime.resolve(readyRuntime);
  await tick;
  expect(launch).not.toHaveBeenCalled();
  expect(store.get("task", task.id)?.status).toBe("paused");
});

test("reordering and scheduling pending messages preserve the active turn and reject stale targets", async () => {
  const { store, task, turn, post } = fixture();
  const scheduledAt = new Date(Date.now() + 3600000).toISOString();
  expect(
    (
      await post({
        action: "schedule",
        inputId: "a",
        expectedText: "First message",
        scheduledAt,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await post({
        action: "reorder",
        inputId: "a",
        overId: "b",
        edge: "after",
      })
    ).status,
  ).toBe(200);
  expect(store.get("task", task.id)?.pending.map((input) => input.id)).toEqual([
    "b",
    "a",
  ]);
  expect(store.get("task", task.id)?.pending[1].scheduledAt).toBe(scheduledAt);
  expect(store.get("task", task.id)?.activeTurnId).toBe("current");
  expect(store.get("turn", turn.id)).toEqual(turn);
  const before = store.get("task", task.id);
  for (const body of [
    { action: "reorder", inputId: "a", overId: "consumed", edge: "before" },
    { action: "schedule", inputId: "a", expectedText: "stale", scheduledAt },
    {
      action: "schedule",
      inputId: "a",
      expectedText: "First message",
      scheduledAt: "yesterday",
    },
    {
      action: "schedule",
      inputId: "a",
      expectedText: "First message",
      scheduledAt: "2020-01-01T00:00:00Z",
    },
  ])
    expect((await post(body)).status).toBe(400);
  expect(store.get("task", task.id)).toEqual(before);
  await post({ action: "promote", inputId: "a" });
  expect(store.get("task", task.id)?.pending[0]).toMatchObject({
    id: "a",
    scheduledAt: null,
  });
});

test("future inputs do not block due messages or occupy a runtime slot", async () => {
  const { store, task, engine } = fixture();
  const scheduledAt = new Date(Date.now() + 3600000).toISOString();
  const pending = [{ ...task.pending[0], scheduledAt }, task.pending[1]];
  expect(dueInput(pending)?.id).toBe("b");
  expect(dueInput(pending, Date.parse(scheduledAt))?.id).toBe("a");
  store.put("task", task.id, {
    ...task,
    activeTurnId: null,
    status: "queued",
    pending: [pending[0]],
  });
  const runtime = spyOn(engine, "runtime").mockResolvedValue(readyRuntime);
  const launch = spyOn(
    engine as unknown as { launch(task: Task): Promise<void> },
    "launch",
  ).mockResolvedValue();
  await engine.tick();
  expect(runtime).not.toHaveBeenCalled();
  expect(launch).not.toHaveBeenCalled();
  store.put("task", task.id, {
    ...task,
    activeTurnId: null,
    status: "queued",
    pending,
  });
  await engine.tick();
  expect(launch).toHaveBeenCalledTimes(1);
  expect(dueInput(launch.mock.calls[0][0].pending)?.id).toBe("b");
});

test("scheduling during a runtime check prevents the waiting message from starting", async () => {
  const { store, task, engine, post } = fixture();
  store.put("task", task.id, {
    ...task,
    activeTurnId: null,
    status: "queued",
    pending: [task.pending[0]],
  });
  const runtime = Promise.withResolvers<Runtime>();
  spyOn(engine, "runtime").mockReturnValue(runtime.promise);
  const launch = spyOn(
    engine as unknown as { launch(task: Task): Promise<void> },
    "launch",
  ).mockResolvedValue();
  const tick = engine.tick();
  await post({
    action: "schedule",
    inputId: "a",
    expectedText: "First message",
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
  });
  runtime.resolve(readyRuntime);
  await tick;
  expect(launch).not.toHaveBeenCalled();
});

test("a new scheduled follow-up is durable and retries do not duplicate it", async () => {
  const { store, task, engine } = fixture();
  spyOn(engine, "tick").mockResolvedValue();
  const api = createApi(store, engine, "test");
  const scheduledAt = new Date(Date.now() + 3600000).toISOString();
  const key = crypto.randomUUID();
  const send = () =>
    api(
      new Request("http://localhost/tasks/task/follow-up", {
        method: "POST",
        headers: { authorization: "Bearer test", "Idempotency-Key": key },
        body: JSON.stringify({ text: "Later message", scheduledAt }),
      }),
    );
  expect((await send()).status).toBe(200);
  expect((await send()).status).toBe(200);
  const current = store.get("task", task.id)!;
  expect(current.pending).toHaveLength(3);
  expect(current.pending[2]).toMatchObject({
    text: "Later message",
    scheduledAt,
  });
  expect(current.activeTurnId).toBe(task.activeTurnId);
});

test("review follow-ups persist trusted-shape labels without allowing client Autopilot origins", async () => {
  const { store, task, engine } = fixture();
  const tick = spyOn(engine, "tick").mockResolvedValue();
  const api = createApi(store, engine, "test");
  const send = (body: unknown, key = crypto.randomUUID()) =>
    api(
      new Request("http://localhost/tasks/task/follow-up", {
        method: "POST",
        headers: { authorization: "Bearer test", "Idempotency-Key": key },
        body: JSON.stringify(body),
      }),
    );
  const text =
    'Please address this review.\n{"comments":[{"comment":"Keep the tests"}]}';
  const requestOrigin = { kind: "review", commentCount: 1 };
  const key = crypto.randomUUID();
  expect((await send({ text, requestOrigin }, key)).status).toBe(200);
  expect((await send({ text, requestOrigin }, key)).status).toBe(200);
  expect(store.get("task", task.id)?.pending).toHaveLength(3);
  expect(store.get("task", task.id)?.pending.at(-1)).toMatchObject({
    text,
    requestOrigin,
  });

  const before = store.get("task", task.id);
  for (const invalidOrigin of [
    { kind: "review", commentCount: 0 },
    { kind: "review", commentCount: 51 },
    { kind: "review", commentCount: 1.5 },
    { kind: "review", commentCount: "1" },
    { kind: "review" },
    { kind: "autopilot", action: "repair" },
  ])
    expect((await send({ text, requestOrigin: invalidOrigin })).status).toBe(
      400,
    );
  expect(store.get("task", task.id)).toEqual(before);
  expect(tick).toHaveBeenCalledTimes(2);

  expect((await send({ text: "A regular follow-up" })).status).toBe(200);
  expect(store.get("task", task.id)?.pending.at(-1)).toMatchObject({
    text: "A regular follow-up",
  });
  expect(
    store.get("task", task.id)?.pending.at(-1)?.requestOrigin,
  ).toBeUndefined();
});

test("retrying a failed review retains its compact label and complete review context", async () => {
  const { store, task, turn, engine } = fixture();
  const tick = spyOn(engine, "tick").mockResolvedValue();
  const api = createApi(store, engine, "test");
  const prompt =
    'Review context\n{"reviewedRevision":"head","comments":[{"comment":"Handle blank names"}]}';
  const requestOrigin = { kind: "review" as const, commentCount: 1 };
  store.put("task", task.id, {
    ...task,
    pending: [],
    activeTurnId: null,
    status: "failed",
    error: "Agent connection interrupted.",
  });
  store.put("turn", turn.id, {
    ...turn,
    prompt,
    requestOrigin,
    status: "failed",
    endedAt: "after",
  });
  const retry = () =>
    api(
      new Request("http://localhost/tasks/task/retry", {
        method: "POST",
        headers: { authorization: "Bearer test" },
        body: "{}",
      }),
    );
  const response = await retry();
  expect(response.status).toBe(200);
  const retried = taskSchema.parse(await response.json());
  expect(retried.pending).toHaveLength(1);
  expect(retried.pending[0]).toMatchObject({
    text: prompt,
    requestOrigin,
    scheduledAt: null,
  });
  expect(
    requestLabel(retried.pending[0]!.text, retried.pending[0]!.requestOrigin),
  ).toBe("Review feedback · 1 comment");
  expect(retried.status).toBe("queued");
  expect(retried.error).toBeNull();
  expect(store.get("task", task.id)?.pending).toEqual(retried.pending);
  expect(tick).toHaveBeenCalledTimes(1);
  expect((await retry()).status).toBe(200);
  expect(store.get("task", task.id)?.pending).toEqual(retried.pending);
});
