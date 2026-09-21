import {
  ordered,
  reorder,
  sandboxSchema,
  settingsSchema,
} from "@nerilo/protocol";
import { z } from "zod";
import { saveMcpServers } from "../tools/mcp";
import {
  discoverGithubSkills,
  importGithubSkill,
} from "../tools/skill-sources";
import { saveAgentSkills } from "../tools/skills";
import { type ApiContext, json } from "./context";

export async function handleSettingsMutation(
  path: string,
  body: unknown,
  { store, requireTask }: ApiContext,
) {
  if (path === "/sandbox-defaults") {
    const settings = store.get("settings", "default")!;
    const sandbox = sandboxSchema.parse(body);
    store.put("settings", "default", { ...settings, sandbox });
    return json(sandbox);
  }
  if (path === "/skills/discover")
    return json(await discoverGithubSkills(body));
  if (path === "/skills/import") return json(await importGithubSkill(body));
  if (path === "/skills") {
    const { skills } = z.object({ skills: z.unknown() }).parse(body);
    return json(saveAgentSkills(store, skills));
  }
  if (path === "/mcp-servers") {
    const { servers } = z.object({ servers: z.unknown() }).parse(body);
    return json(saveMcpServers(store, servers));
  }
  if (path === "/sidebar-order") {
    const { kind, id, overId, edge } = z
      .object({
        kind: z.enum(["project", "task"]),
        id: z.string(),
        overId: z.string(),
        edge: z.enum(["before", "after"]),
      })
      .parse(body);
    const settings = store.get("settings", "default")!;
    const order = settings.sidebarOrder;
    if (kind === "project") {
      if (!store.get("project", id) || !store.get("project", overId))
        throw new Error("Project no longer exists.");
      order.projects = reorder(
        ordered(store.all("project"), order.projects).map((p) => p.id),
        id,
        overId,
        edge,
      );
    } else {
      const task = requireTask(id),
        target = requireTask(overId);
      if (task.projectId !== target.projectId)
        throw new Error("Reorder tasks within their project.");
      const tasks = store
        .all("task")
        .filter((t) => t.projectId === task.projectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      order.tasks[task.projectId] = reorder(
        ordered(tasks, order.tasks[task.projectId] ?? []).map((t) => t.id),
        id,
        overId,
        edge,
      );
    }
    store.put("settings", "default", { ...settings, sidebarOrder: order });
    store.event({
      taskId: null,
      turnId: null,
      kind: "system",
      text: "Sidebar reordered.",
    });
    return json(order);
  }
  if (path === "/settings") {
    const previous = store.get("settings", "default")!;
    const settings = {
      ...settingsSchema.parse({
        ...previous,
        ...z.record(z.string(), z.unknown()).parse(body),
      }),
      sidebarOrder: previous.sidebarOrder,
      sandbox: previous.sandbox,
      mcpServers: previous.mcpServers,
      skills: previous.skills,
    };
    store.put("settings", "default", settings);
    return json(settings);
  }
}
