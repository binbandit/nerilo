import { z } from "zod";
import type { Task } from "@nerilo/protocol";
import type { Store } from "../platform/store";
import { now } from "../platform/config";

const inputId = z.string().min(1);
const expectedText = z.string().max(30000);
export const queueActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("edit"),
    inputId,
    expectedText,
    text: z.string().trim().min(1).max(30000),
  }),
  z.object({ action: z.literal("promote"), inputId }),
  z.object({ action: z.literal("remove"), inputId, expectedText }),
  z.object({
    action: z.literal("reorder"),
    inputId,
    overId: inputId,
    edge: z.enum(["before", "after"]),
  }),
  z.object({
    action: z.literal("schedule"),
    inputId,
    expectedText,
    scheduledAt: z.string().datetime({ offset: true }).nullable(),
  }),
]);

export function dueInput(pending: Task["pending"], at = Date.now()) {
  return pending.find(
    (input) => !input.scheduledAt || Date.parse(input.scheduledAt) <= at,
  );
}

export function validateSchedule(scheduledAt: string | null) {
  if (!scheduledAt) return null;
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now())
    throw new Error("Choose a time in the future.");
  return date.toISOString();
}

export function updateQueue(
  store: Store,
  taskId: string,
  action: z.infer<typeof queueActionSchema>,
) {
  return store.transaction(() => {
    const task = store.get("task", taskId);
    if (!task) throw new Error("Task not found.");
    if (task.archived)
      throw new Error("Restore this task before changing queued messages.");
    const input = task.pending.find((item) => item.id === action.inputId);
    if (!input)
      throw new Error(
        "This message is no longer queued. It may already be running.",
      );
    if ("expectedText" in action && input.text !== action.expectedText)
      throw new Error(
        "This queued message changed. Review the latest text and try again.",
      );
    let pending =
      action.action === "edit"
        ? task.pending.map((item) =>
            item.id === input.id ? { ...item, text: action.text } : item,
          )
        : action.action === "promote"
          ? [input, ...task.pending.filter((item) => item.id !== input.id)]
          : action.action === "remove"
            ? task.pending.filter((item) => item.id !== input.id)
            : task.pending;
    if (action.action === "reorder") {
      if (!task.pending.some((item) => item.id === action.overId))
        throw new Error("The target message is no longer queued.");
      if (input.id === action.overId) return task;
      pending = task.pending.filter((item) => item.id !== input.id);
      const index = pending.findIndex((item) => item.id === action.overId);
      pending.splice(index + (action.edge === "after" ? 1 : 0), 0, input);
    }
    if (action.action === "schedule") {
      const scheduledAt = validateSchedule(action.scheduledAt);
      pending = task.pending.map((item) =>
        item.id === input.id ? { ...item, scheduledAt } : item,
      );
    }
    if (action.action === "promote")
      pending = pending.map((item) =>
        item.id === input.id ? { ...item, scheduledAt: null } : item,
      );
    const next: Task = {
      ...task,
      pending,
      status:
        !task.activeTurnId && !pending.length && task.status === "queued"
          ? "paused"
          : task.status,
      updatedAt: now(),
    };
    store.put("task", task.id, next);
    store.event({
      taskId,
      turnId: null,
      kind: action.action === "edit" ? "user" : "system",
      text:
        action.action === "edit"
          ? `Queued message edited:\n${action.text}`
          : action.action === "promote"
            ? `Queued message moved to next:\n${input.text}`
            : action.action === "reorder"
              ? `Queued message reordered:\n${input.text}`
              : action.action === "schedule"
                ? `Queued message ${action.scheduledAt ? `scheduled for ${action.scheduledAt}` : "set to deliver next"}:\n${input.text}`
                : `Queued message removed:\n${input.text}`,
    });
    return next;
  });
}
