import type { Task } from "@nerilo/protocol";

type TaskIdentity = Pick<Task, "id" | "projectId" | "title" | "createdAt">;

export function duplicateTaskLabels(tasks: readonly TaskIdentity[]) {
  const groups = new Map<string, TaskIdentity[]>();
  for (const task of tasks) {
    const key = JSON.stringify([task.projectId, task.title]);
    const group = groups.get(key);
    if (group) group.push(task);
    else groups.set(key, [task]);
  }
  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort(
      (a, b) =>
        Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    group.forEach((task, index) =>
      labels.set(task.id, `Workspace ${index + 1} · ${task.title}`),
    );
  }
  return labels;
}
