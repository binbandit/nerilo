import { z } from "zod";
import type { AgentSkill } from "./skills";
import type { McpServer } from "./mcp";

const selectionSchema = z
  .array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/))
  .max(128)
  .refine((ids) => new Set(ids).size === ids.length, "Choose each tool once.")
  .nullable();

export const agentToolsSchema = z
  .object({
    skillIds: selectionSchema,
    mcpServerIds: selectionSchema,
  })
  .strict();
export type AgentTools = z.infer<typeof agentToolsSchema>;

export function resolveAgentTools(
  settings: { skills: AgentSkill[]; mcpServers: McpServer[] },
  tools: AgentTools,
) {
  return {
    skills: settings.skills.filter(
      (skill) =>
        skill.enabled &&
        (tools.skillIds === null || tools.skillIds.includes(skill.id)),
    ),
    mcpServers: settings.mcpServers.filter(
      (server) =>
        server.enabled &&
        (tools.mcpServerIds === null || tools.mcpServerIds.includes(server.id)),
    ),
  };
}
