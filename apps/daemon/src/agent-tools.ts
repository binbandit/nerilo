import {
  agentToolsSchema,
  resolveAgentTools,
  type Settings,
  type Sandbox,
  type AgentTools,
} from "@nerilo/protocol";
import type { Store } from "./store";
import { now } from "./config";
import { requireAvailableProject } from "./project-lifecycle";
import { taskMcpServers } from "./mcp";

export function validateAgentTools(settings: Settings, input: unknown) {
  const tools = agentToolsSchema.parse(input);
  if (
    tools.skillIds?.some(
      (id) => !settings.skills.some((skill) => skill.id === id),
    )
  )
    throw new Error(
      "A selected skill no longer exists. Refresh and choose again.",
    );
  if (
    tools.mcpServerIds?.some(
      (id) => !settings.mcpServers.some((server) => server.id === id),
    )
  )
    throw new Error(
      "A selected MCP server no longer exists. Refresh and choose again.",
    );
  return tools;
}

export function taskAgentTools(
  settings: Settings,
  tools: AgentTools,
  sandbox: Sandbox,
) {
  const selected = resolveAgentTools(settings, tools);
  return {
    skills: selected.skills,
    mcpServers: taskMcpServers(
      { ...settings, mcpServers: selected.mcpServers },
      sandbox,
    ),
  };
}

export function saveTaskAgentTools(
  store: Store,
  taskId: string,
  input: unknown,
) {
  const task = store.get("task", taskId);
  if (!task) throw new Error("Task not found.");
  requireAvailableProject(store, task.projectId);
  const tools = validateAgentTools(store.get("settings", "default")!, input);
  const updated = { ...task, tools, updatedAt: now() };
  store.transaction(() => {
    store.put("task", taskId, updated);
    store.event({
      taskId,
      turnId: null,
      kind: "system",
      text: "Agent tools updated for the next turn.",
    });
  });
  return updated;
}
