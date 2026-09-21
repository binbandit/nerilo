import { test, expect } from "bun:test";
import { taskSchema } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { deleteTask } from "./task-delete";

function fixture() {
  const store = new Store(":memory:");
  const id = crypto.randomUUID();
  const task = taskSchema.parse({
    id,
    projectId: "project",
    title: "Delete fixture",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "paused",
    sessionId: null,
    baseCommit: null,
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "now",
    updatedAt: "now",
    archived: false,
    error: null,
    stopRequested: false,
  });
  store.put("task", id, task);
  store.event({
    taskId: id,
    turnId: null,
    kind: "user",
    text: "private test history",
  });
  return { store, id, task };
}
test("task deletion cleans only owned resources and removes history and replay cache", async () => {
  const { store, id, task } = fixture();
  const other = { ...task, id: crypto.randomUUID() };
  store.put("task", other.id, other);
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args.includes("ps")) return "owned-container";
    if (args.includes("volume") && args.includes("ls"))
      return `nerilo-work-${id}\nnerilo-home-${id}\nnerilo-work-${other.id}`;
    return "";
  };
  store.command("saved-task", () => task);
  try {
    await deleteTask(store, id, run);
    expect(store.get("task", id)).toBeNull();
    expect(store.events(id)).toHaveLength(0);
    expect(store.get("task", other.id)).not.toBeNull();
    expect(store.commandResult("saved-task")).toBeNull();
    expect(calls).toContainEqual([
      "docker",
      "volume",
      "rm",
      `nerilo-work-${id}`,
    ]);
    expect(calls.some((args) => args.includes(`nerilo-work-${other.id}`))).toBe(
      false,
    );
  } finally {
    store.db.close();
  }
});
test("active tasks cannot be deleted and incomplete cleanup leaves recoverable archived history", async () => {
  const { store, id, task } = fixture();
  let calls = 0;
  const run = async () => {
    calls++;
    throw new Error(
      "failed to connect to the docker API at unix:///test/docker.sock: connect: no such file or directory",
    );
  };
  try {
    store.put("task", id, { ...task, status: "working", activeTurnId: "turn" });
    await expect(deleteTask(store, id, run)).rejects.toThrow("Pause");
    expect(calls).toBe(0);
    store.put("task", id, task);
    await expect(deleteTask(store, id, run)).rejects.toThrow(
      "Start Docker, then retry deletion.",
    );
    expect(store.get("task", id)?.archived).toBe(true);
    expect(store.events(id)[0].text).toBe("private test history");
  } finally {
    store.db.close();
  }
});
