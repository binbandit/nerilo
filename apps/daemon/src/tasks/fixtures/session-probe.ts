import { join } from "node:path";
import { z } from "zod";
import {
  taskSchema,
  turnSchema,
  projectSchema,
  type Task,
} from "@nerilo/protocol";
import { Store } from "../../platform/store";
import { createApi } from "../../http/api";
import { Engine } from "../engine";

const payloadSchema = z.object({ sessionId: z.string().nullable() });
const scenarios = [
  { name: "model", provider: "codex", model: "", effort: "high" },
  { name: "effort", provider: "codex", model: "original-model", effort: "" },
  { name: "both", provider: "codex", model: "", effort: "" },
  { name: "provider", provider: "claude", model: "", effort: "" },
];
const results = [];
for (const { name, ...execution } of scenarios) {
  const store = new Store(":memory:");
  const task = taskSchema.parse({
    id: crypto.randomUUID(),
    projectId: "project",
    title: "Session fixture",
    provider: "codex",
    presetId: "programmer",
    model: "original-model",
    effort: "high",
    status: "ready",
    sessionId: "original-session",
    sessionProvider: "codex",
    baseCommit: "retained-base",
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "before",
    updatedAt: "before",
    archived: false,
    error: null,
    stopRequested: false,
  });
  store.put(
    "project",
    "project",
    projectSchema.parse({
      id: "project",
      name: "Fixture",
      path: "/unused",
      branch: "main",
      createdAt: "before",
    }),
  );
  store.put("task", task.id, task);
  store.put(
    "turn",
    "original",
    turnSchema.parse({
      id: "original",
      taskId: task.id,
      inputId: "original",
      prompt: "Original request",
      status: "finished",
      container: "unused",
      cursor: 0,
      connectionId: "direct",
      execution: {
        provider: task.provider,
        model: task.model,
        effort: task.effort,
      },
      startedAt: new Date(0).toISOString(),
      endedAt: new Date(0).toISOString(),
      result: {
        exitCode: 0,
        sessionId: task.sessionId,
        summary: "Original response",
        diff: "",
        changes: [],
        verification: null,
        baseCommit: task.baseCommit,
        headCommit: "head",
      },
    }),
  );
  const engine = new Engine(store, true);
  engine.tick = async () => {};
  const api = createApi(store, engine, "fixture");
  const act = async (action: string, body: unknown = {}) => {
    const response = await api(
      new Request(`http://localhost/tasks/${task.id}/${action}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) throw new Error(await response.text());
  };
  const internal = engine as unknown as {
    launch(task: Task): Promise<void>;
    consume(
      taskId: string,
      turnId: string,
      event: { type: "session"; id: string },
    ): void;
  };
  const launch = async () => {
    await internal.launch(store.get("task", task.id)!);
    const turn = store.get("turn", store.get("task", task.id)!.activeTurnId!)!;
    const path = join(
      process.env.NERILO_SESSION_CAPTURE!,
      `${turn.container}.json`,
    );
    for (let attempt = 0; attempt < 200; attempt++) {
      const capture = Bun.file(path);
      if (await capture.exists()) {
        const payload = payloadSchema.safeParse(
          await capture.json().catch(() => null),
        );
        if (payload.success) return payload.data.sessionId;
      }
      await Bun.sleep(5);
    }
    throw new Error("The fixture did not capture the launch payload.");
  };
  await act("follow-up", { text: "Continue with the same settings" });
  const unchanged = await launch();
  engine.fail(task.id, "Interrupted before a session event");
  await act("execution", execution);
  await act("retry");
  const first = await launch();
  engine.fail(task.id, "Interrupted before a replacement session starts");
  await act("retry");
  const retry = await launch();
  engine.fail(task.id, "Interrupted again before a replacement session starts");
  await act("retry");
  const repeatedRetry = await launch();
  internal.consume(task.id, store.get("task", task.id)!.activeTurnId!, {
    type: "session",
    id: "replacement-session",
  });
  engine.fail(task.id, "Interrupted after the replacement session starts");
  await act("retry");
  const replacement = await launch();
  results.push({ name, unchanged, first, retry, repeatedRetry, replacement });
  await Bun.sleep(0);
  store.db.close();
}
console.log(JSON.stringify(results));
