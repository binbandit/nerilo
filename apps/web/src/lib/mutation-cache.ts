import type { QueryClient } from "@tanstack/react-query";
import {
  agentSkillsSchema,
  autonomySchema,
  mcpServersSchema,
  gatewayViewSchema,
  githubAccountsSchema,
  providerSchema,
  projectSchema,
  presetSchema,
  noteSchema,
  runtimeSchema,
  sandboxSchema,
  settingsSchema,
  sidebarOrderSchema,
  taskSchema,
  type Settings,
  type Snapshot,
  type TaskDetail,
} from "@nerilo/protocol";
import { queries, queryKeys } from "@/lib/query-options";

export function mutationKeys(machine: string, path: string) {
  if (path === "connections/github/switch") return [queryKeys.machine(machine)];
  const [resource, id, action] = path.split("/");
  if (resource === "machines") return [queryKeys.registry];
  if (
    path.endsWith("/preview") ||
    path === "skills/discover" ||
    path === "skills/import"
  )
    return [];
  const affected: (readonly string[])[] = [queryKeys.snapshot(machine)];
  if (resource === "tasks" && id) affected.push(queryKeys.task(machine, id));
  if (resource === "projects" && (action === "archive" || action === "delete"))
    affected.push([...queryKeys.machine(machine), "tasks"]);
  if (resource === "projects" && id && !action)
    affected.push([...queryKeys.machine(machine), "tasks"]);
  if (resource === "connections") {
    affected.push([...queryKeys.machine(machine), "connections"]);
    affected.push(queries.models(machine).queryKey);
  }
  if (
    resource === "projects" ||
    path.includes("/pull-requests") ||
    path.includes("/git")
  )
    affected.push([...queryKeys.machine(machine), "projects"]);
  return affected;
}

function upsert<T extends { id: string }>(values: T[], next: T) {
  return values.some((value) => value.id === next.id)
    ? values.map((value) => (value.id === next.id ? next : value))
    : [...values, next];
}

function acceptedRemoval(result: unknown) {
  return (
    result !== null &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok === true
  );
}

export function applyMutationResult(
  client: QueryClient,
  machine: string,
  path: string,
  result: unknown,
  body?: unknown,
) {
  const patchSnapshot = (update: (snapshot: Snapshot) => Snapshot) => {
    client.setQueryData<Snapshot>(queryKeys.snapshot(machine), (snapshot) =>
      snapshot ? update(snapshot) : snapshot,
    );
  };
  const patchSettings = (patch: Partial<Settings>) => {
    patchSnapshot((snapshot) => ({
      ...snapshot,
      settings: { ...snapshot.settings, ...patch },
    }));
  };
  if (path === "settings") patchSettings(settingsSchema.parse(result));
  else if (path === "sidebar-order")
    patchSettings({ sidebarOrder: sidebarOrderSchema.parse(result) });
  else if (path === "sandbox-defaults")
    patchSettings({ sandbox: sandboxSchema.parse(result) });
  else if (path === "skills")
    patchSettings({ skills: agentSkillsSchema.parse(result) });
  else if (path === "mcp-servers")
    patchSettings({ mcpServers: mcpServersSchema.parse(result) });

  const [resource, id, action] = path.split("/");
  const remove =
    acceptedRemoval(result) &&
    body !== null &&
    typeof body === "object" &&
    "remove" in body &&
    body.remove === true;

  if (resource === "connections") {
    if (id === "github" && action === "switch") {
      client.setQueryData(
        queries.githubAccounts(machine).queryKey,
        githubAccountsSchema.parse(result),
      );
    } else if (!id) {
      const runtime = runtimeSchema.parse(result);
      patchSnapshot((snapshot) => ({ ...snapshot, runtime }));
    } else if (action === "gateway" || action === "gateway-import") {
      client.setQueryData(
        queries.gateway(machine, providerSchema.parse(id)).queryKey,
        gatewayViewSchema.parse(result),
      );
    }
  }

  if (resource === "notes" && !action) {
    if (remove)
      patchSnapshot((snapshot) => ({
        ...snapshot,
        notes: snapshot.notes.filter((note) => note.id !== id),
      }));
    else {
      const note = noteSchema.parse(result);
      patchSnapshot((snapshot) => ({
        ...snapshot,
        notes: upsert(snapshot.notes, note),
      }));
    }
  }
  if (resource === "presets" && !action) {
    if (remove)
      patchSnapshot((snapshot) => ({
        ...snapshot,
        presets: snapshot.presets.filter((preset) => preset.id !== id),
      }));
    else {
      const preset = presetSchema.parse(result);
      patchSnapshot((snapshot) => ({
        ...snapshot,
        presets: upsert(snapshot.presets, preset),
      }));
    }
  }
  if (resource === "projects") {
    if (action === "delete" && acceptedRemoval(result)) {
      const snapshot = client.getQueryData<Snapshot>(
        queryKeys.snapshot(machine),
      );
      for (const task of snapshot?.tasks ?? []) {
        if (task.projectId === id)
          client.removeQueries({ queryKey: queryKeys.task(machine, task.id) });
      }
      client.removeQueries({
        queryKey: [...queryKeys.machine(machine), "projects", id],
      });
      patchSnapshot((snapshot) => {
        const order = snapshot.settings.sidebarOrder;
        return {
          ...snapshot,
          projects: snapshot.projects.filter((project) => project.id !== id),
          tasks: snapshot.tasks.filter((task) => task.projectId !== id),
          notes: snapshot.notes.filter((note) => note.projectId !== id),
          settings: {
            ...snapshot.settings,
            sidebarOrder: {
              projects: order.projects.filter((projectId) => projectId !== id),
              tasks: Object.fromEntries(
                Object.entries(order.tasks).filter(
                  ([projectId]) => projectId !== id,
                ),
              ),
            },
          },
        };
      });
    } else if (!action || action === "archive") {
      const project = projectSchema.parse(result);
      patchSnapshot((snapshot) => ({
        ...snapshot,
        projects: upsert(snapshot.projects, project),
      }));
    }
  }
  if (resource !== "tasks") return;
  if (action === "autonomy") {
    client.setQueryData(
      queries.autonomy(machine, id).queryKey,
      autonomySchema.nullable().parse(result),
    );
  } else if (action === "delete" && acceptedRemoval(result)) {
    client.removeQueries({ queryKey: queryKeys.task(machine, id) });
    patchSnapshot((snapshot) => ({
      ...snapshot,
      tasks: snapshot.tasks.filter((task) => task.id !== id),
      settings: {
        ...snapshot.settings,
        sidebarOrder: {
          ...snapshot.settings.sidebarOrder,
          tasks: Object.fromEntries(
            Object.entries(snapshot.settings.sidebarOrder.tasks).map(
              ([projectId, ids]) => [
                projectId,
                ids.filter((taskId) => taskId !== id),
              ],
            ),
          ),
        },
      },
    }));
  } else {
    const parsed = taskSchema.safeParse(result);
    if (parsed.success) {
      const task = parsed.data;
      patchSnapshot((snapshot) => ({
        ...snapshot,
        tasks: upsert(snapshot.tasks, task).toSorted((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
      }));
      client.setQueryData<TaskDetail>(
        queries.task(machine, task.id).queryKey,
        (detail) => (detail ? { ...detail, task } : detail),
      );
    }
  }
}
