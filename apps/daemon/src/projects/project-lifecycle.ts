import { activeStatuses, type Project } from "@nerilo/protocol";
import type { Store } from "../platform/store";
import { checked, now } from "../platform/config";
import { deleteTask } from "../tasks/task-delete";
import { isTaskLocked, withTaskLock } from "../tasks/task-locks";

const deleting = new Set<string>();
export const isProjectDeleting = (id: string) => deleting.has(id);

export function requireAvailableProject(store: Store, id: string) {
  const project = store.get("project", id);
  if (!project) throw new Error("Project not found.");
  if (project.archived || deleting.has(id))
    throw new Error("Restore this project before continuing.");
  return project;
}

function idleProject(store: Store, id: string) {
  const project = store.get("project", id);
  if (!project) throw new Error("Project not found.");
  if (deleting.has(id))
    throw new Error("This project is being deleted. Try again shortly.");
  const tasks = store.all("task").filter((task) => task.projectId === id);
  if (
    tasks.some(
      (task) =>
        task.activeTurnId ||
        activeStatuses.includes(task.status) ||
        isTaskLocked(task.id),
    )
  )
    throw new Error(
      "Pause running agents and wait for Git actions to finish before changing this project.",
    );
  return { project, tasks };
}

function pauseAndArchive(store: Store, project: Project) {
  return store.transaction(() => {
    const hasAutonomy = Boolean(
      store.db
        .query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='task_autonomy'",
        )
        .get(),
    );
    const autonomous = new Set(
      hasAutonomy
        ? store.db
            .query<{ taskId: string }, []>(
              "SELECT taskId FROM task_autonomy WHERE json_extract(data,'$.mode')!='off' AND json_extract(data,'$.status') NOT IN ('merged','closed')",
            )
            .all()
            .map((value) => value.taskId)
        : [],
    );
    for (const task of store
      .all("task")
      .filter((task) => task.projectId === project.id)) {
      if (task.status === "queued" || autonomous.has(task.id))
        store.put("task", task.id, {
          ...task,
          status: "paused",
          updatedAt: now(),
        });
    }
    const next = { ...project, archived: true };
    store.put("project", project.id, next);
    return next;
  });
}

export function archiveProject(store: Store, id: string, archived: boolean) {
  const { project } = idleProject(store, id);
  const next = archived
    ? pauseAndArchive(store, project)
    : { ...project, archived: false };
  if (!archived) store.put("project", id, next);
  store.event({
    taskId: null,
    turnId: null,
    kind: "system",
    text: archived
      ? "Project archived. Queued work is paused."
      : "Project restored. Paused tasks remain paused.",
  });
  return next;
}

export async function deleteProject(store: Store, id: string, run = checked) {
  const { project, tasks } = idleProject(store, id);
  deleting.add(id);
  try {
    // The archived record survives a failed cleanup and closes creation/scheduling races.
    pauseAndArchive(store, project);
    for (const task of tasks)
      await withTaskLock(task.id, () => deleteTask(store, task.id, run));
    store.transaction(() => {
      for (const note of store
        .all("note")
        .filter((note) => note.projectId === id)) {
        store.remove("note", note.id);
        store.db
          .query("DELETE FROM commands WHERE json_extract(response,'$.id')=?")
          .run(note.id);
      }
      const settings = store.get("settings", "default")!;
      const orderedTasks = { ...settings.sidebarOrder.tasks };
      delete orderedTasks[id];
      store.put("settings", "default", {
        ...settings,
        sidebarOrder: {
          projects: settings.sidebarOrder.projects.filter(
            (value) => value !== id,
          ),
          tasks: orderedTasks,
        },
      });
      store.db
        .query(
          "DELETE FROM commands WHERE json_extract(response,'$.projectId')=? OR json_extract(response,'$.id')=?",
        )
        .run(id, id);
      store.remove("project", id);
      store.event({
        taskId: null,
        turnId: null,
        kind: "system",
        text: "Project deleted. Repository folders and exported work were kept.",
      });
    });
    return { ok: true };
  } catch (error) {
    store.event({
      taskId: null,
      turnId: null,
      kind: "error",
      text: "Project deletion could not finish. The project remains archived; retry deletion to finish cleanup.",
    });
    throw error;
  } finally {
    deleting.delete(id);
  }
}
