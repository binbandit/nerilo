import { rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { activeStatuses } from "@nerilo/protocol";
import type { Store } from "./store";
import { checked, dataDir } from "./config";

const deleting = new Set<string>();
export async function deleteTask(store: Store, id: string, run = checked) {
  z.uuid().parse(id);
  const task = store.get("task", id);
  if (!task) throw new Error("Task not found.");
  if (task.activeTurnId || activeStatuses.includes(task.status))
    throw new Error("Pause this task before deleting it.");
  if (deleting.has(id)) throw new Error("This task is already being deleted.");
  deleting.add(id);
  // Prevent the scheduler or new follow-ups from restarting a sandbox during cleanup.
  store.put("task", id, { ...task, archived: true });
  try {
    const containers = await run([
      "docker",
      "ps",
      "-aq",
      "--filter",
      "label=dev.nerilo.managed=true",
      "--filter",
      `label=dev.nerilo.task=${id}`,
    ]);
    for (const container of containers.split(/\s+/).filter(Boolean))
      await run(["docker", "rm", "-f", container]);
    const networks = await run([
      "docker",
      "network",
      "ls",
      "--filter",
      "label=dev.nerilo.managed=true",
      "--filter",
      `label=dev.nerilo.task=${id}`,
      "--format",
      "{{.ID}}",
    ]);
    for (const network of networks.split(/\s+/).filter(Boolean))
      await run(["docker", "network", "rm", network]);
    const volumes = (
      await run(["docker", "volume", "ls", "--format", "{{.Name}}"])
    ).split("\n");
    for (const name of [
      `nerilo-work-${id}`,
      `nerilo-home-${id}`,
      `nerilo-claude-projects-${id}`,
    ])
      if (volumes.includes(name)) await run(["docker", "volume", "rm", name]);
    await rm(join(dataDir, "snapshots", `${id}.bundle`), { force: true });
    store.transaction(() => {
      for (const turn of store
        .all("turn")
        .filter((value) => value.taskId === id))
        store.db
          .query("DELETE FROM records WHERE kind='turn' AND id=?")
          .run(turn.id);
      store.db.query("DELETE FROM records WHERE kind='task' AND id=?").run(id);
      store.db.query("DELETE FROM events WHERE taskId=?").run(id);
      store.db
        .query("DELETE FROM commands WHERE json_extract(response, '$.id')=?")
        .run(id);
      for (const table of ["task_autonomy", "task_state_summary"]) {
        if (
          store.db
            .query(
              "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            )
            .get(table)
        )
          store.db.query(`DELETE FROM ${table} WHERE taskId=?`).run(id);
      }
      const settings = store.get("settings", "default")!;
      store.put("settings", "default", {
        ...settings,
        sidebarOrder: {
          ...settings.sidebarOrder,
          tasks: Object.fromEntries(
            Object.entries(settings.sidebarOrder.tasks).map(
              ([projectId, ids]) => [
                projectId,
                ids.filter((value) => value !== id),
              ],
            ),
          ),
        },
      });
      store.event({
        taskId: null,
        turnId: null,
        kind: "system",
        text: "Task deleted.",
      });
    });
    return { ok: true };
  } catch (error) {
    store.event({
      taskId: id,
      turnId: null,
      kind: "error",
      text: "Task deletion could not finish. The task is archived; retry deletion to finish cleanup.",
    });
    if (
      error instanceof Error &&
      /failed to connect to the docker API|cannot connect to the docker daemon|is the docker daemon running/i.test(
        error.message,
      )
    )
      throw new Error(
        "Start Docker, then retry deletion. Your remaining tasks and history are kept until cleanup finishes.",
        { cause: error },
      );
    throw error;
  } finally {
    deleting.delete(id);
  }
}
