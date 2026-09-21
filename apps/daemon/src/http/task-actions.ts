import { reviewRequestOriginSchema } from "@nerilo/protocol";
import { z } from "zod";
import { now } from "../platform/config";
import { requireAvailableProject } from "../projects/project-lifecycle";
import { validateSchedule } from "../tasks/queue-actions";
import { withTaskLock } from "../tasks/task-locks";
import { type ApiContext, json } from "./context";

export async function handleTaskAction(
  path: string,
  request: Request,
  body: unknown,
  { store, engine, requireTask, schedule }: ApiContext,
) {
  const action = path.match(
    /^\/tasks\/([^/]+)\/(follow-up|pause|retry|complete|archive|rename|apply|checkout|cancel-input)$/,
  );
  if (!action) return;

  let task = requireTask(action[1]);
  const name = action[2];
  if (name === "checkout") {
    const { turnId } = z.object({ turnId: z.string() }).parse(body);
    return json(
      await withTaskLock(task.id, () =>
        engine.checkout(task, store.get("project", task.projectId)!, turnId),
      ),
    );
  }
  if (name === "follow-up") {
    const { text, scheduledAt, requestOrigin } = z
      .object({
        text: z.string().trim().min(1).max(30000),
        requestOrigin: reviewRequestOriginSchema.optional(),
        scheduledAt: z
          .string()
          .datetime({ offset: true })
          .nullable()
          .default(null),
      })
      .parse(body);
    const key = z.string().uuid().parse(request.headers.get("idempotency-key"));
    const response = store.command(`task:${task.id}:follow-up:${key}`, () => {
      task = requireTask(task.id);
      requireAvailableProject(store, task.projectId);
      if (task.archived)
        throw new Error("Restore this task before continuing.");
      const next = {
        ...task,
        pending: [
          ...task.pending,
          {
            id: crypto.randomUUID(),
            text,
            ...(requestOrigin ? { requestOrigin } : {}),
            createdAt: now(),
            scheduledAt: validateSchedule(scheduledAt),
          },
        ],
        status: task.activeTurnId ? task.status : ("queued" as const),
        error: null,
        updatedAt: now(),
      };
      store.put("task", task.id, next);
      store.event({
        taskId: task.id,
        turnId: null,
        kind: "user",
        text,
      });
      return next;
    });
    schedule();
    return json(response);
  }
  if (name === "apply") {
    const { turnId } = z.object({ turnId: z.string() }).parse(body);
    await withTaskLock(task.id, () =>
      engine.apply(task, store.get("project", task.projectId)!, turnId),
    );
    return json({ ok: true });
  }
  if (name === "pause") {
    task = {
      ...task,
      stopRequested: Boolean(task.activeTurnId),
      status: task.activeTurnId ? task.status : "paused",
    };
  }
  if (name === "retry") {
    if (task.archived) throw new Error("Restore this task before continuing.");
    if (task.activeTurnId) throw new Error("This task is still running.");
    const last = store
      .all("turn")
      .filter((t) => t.taskId === task.id)
      .at(-1);
    if (!task.pending.length) {
      if (!last) throw new Error("Add instructions to continue.");
      task.pending = [
        {
          id: crypto.randomUUID(),
          text: last.prompt,
          ...(last.requestOrigin ? { requestOrigin: last.requestOrigin } : {}),
          createdAt: now(),
          scheduledAt: null,
        },
      ];
    }
    task = {
      ...task,
      status: "queued",
      error: null,
      stopRequested: false,
    };
  }
  if (name === "complete") {
    if (task.activeTurnId || task.pending.length)
      throw new Error("Finish or cancel queued work first.");
    task = { ...task, status: "complete", error: null };
  }
  if (name === "archive") {
    if (task.activeTurnId)
      throw new Error("Pause the task before archiving it.");
    task = {
      ...task,
      archived: z.object({ archived: z.boolean() }).parse(body).archived,
    };
  }
  if (name === "rename")
    task = {
      ...task,
      titleSource: "manual",
      title: z.object({ title: z.string().trim().min(1).max(160) }).parse(body)
        .title,
    };
  if (name === "cancel-input") {
    const { inputId } = z.object({ inputId: z.string() }).parse(body);
    task = {
      ...task,
      pending: task.pending.filter((i) => i.id !== inputId),
    };
    if (!task.activeTurnId && !task.pending.length && task.status === "queued")
      task.status = "paused";
  }
  task.updatedAt = now();
  store.put("task", task.id, task);
  const notices: Record<string, string> = {
    pause: "Pause requested.",
    retry: "Queued to continue.",
    complete: "Marked complete.",
    archive: task.archived ? "Archived." : "Restored.",
    rename: "Task renamed.",
    "cancel-input": "Queued follow-up removed.",
  };
  store.event({
    taskId: task.id,
    turnId: null,
    kind: "system",
    text: notices[name],
  });
  schedule();
  return json(task);
}
