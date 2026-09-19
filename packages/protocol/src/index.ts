import { z } from "zod";
import { sandboxSchema, sandboxDefaults } from "./sandbox";
import { requestOriginSchema } from "./request-origin";
import { repositoryEventSchema } from "./repository-event";
import { shortcutBindingsSchema } from "./keyboard";
import { mcpServersSchema } from "./mcp";
export * from "./mcp";
export * from "./machines";
export * from "./http";
export * from "./gateway";
import { agentSkillsSchema } from "./skills";
import { agentToolsSchema } from "./agent-tools";
export * from "./agent-tools";
export * from "./skills";
export * from "./skill-sources";
export * from "./workspace-files";
export * from "./keyboard";
export * from "./repository-event";
export * from "./sandbox";
export * from "./autonomy";
export * from "./git";
export {
  autopilotPromptPrefix,
  requestLabel,
  requestOriginSchema,
  reviewRequestOriginSchema,
  type RequestOrigin,
} from "./request-origin";

export const providerSchema = z.enum(["codex", "claude"]);
export type Provider = z.infer<typeof providerSchema>;
export const statusSchema = z.enum([
  "queued",
  "preparing",
  "working",
  "checking",
  "ready",
  "paused",
  "failed",
  "check_failed",
  "complete",
]);
export type TaskStatus = z.infer<typeof statusSchema>;
export const projectInput = z.object({
  name: z.string().trim().min(1).max(80),
  path: z.string().trim().max(2000).default(""),
  repository: z.string().trim().max(2000).nullable().default(null),
  branch: z.string().trim().max(180).optional(),
  setup: z.string().max(4000).default(""),
  verify: z.string().max(4000).default(""),
});
export const projectSchema = projectInput.extend({
  id: z.string(),
  branch: z.string(),
  createdAt: z.string(),
  archived: z.boolean().default(false),
});
export type Project = z.infer<typeof projectSchema>;
export const presetInput = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().max(20000),
  provider: providerSchema,
  model: z.string().trim().max(120).default(""),
});
export const presetSchema = presetInput.extend({ id: z.string() });
export type Preset = z.infer<typeof presetSchema>;
export const noteInput = z.object({
  title: z.string().trim().min(1).max(120),
  content: z.string().max(30000),
  projectId: z.string().nullable().default(null),
});
export const noteSchema = noteInput.extend({
  id: z.string(),
  updatedAt: z.string(),
});
export type Note = z.infer<typeof noteSchema>;
export const effortSchema = z.enum([
  "",
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
]);
export const executionSchema = z.object({
  provider: providerSchema,
  model: z.string().trim().max(120),
  effort: effortSchema,
});
export type Execution = z.infer<typeof executionSchema>;
export const modelCatalogSchema = z.object({
  codex: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      efforts: z.array(effortSchema),
      defaultEffort: effortSchema,
    }),
  ),
  claude: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      efforts: z.array(effortSchema),
      defaultEffort: effortSchema,
    }),
  ),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export const taskInput = z.object({
  tools: agentToolsSchema.default({ skillIds: null, mcpServerIds: null }),
  projectId: z.string(),
  prompt: z.string().trim().min(1).max(30000),
  title: z.string().trim().max(160).optional(),
  presetId: z.string(),
  model: z.string().trim().max(120).optional(),
  includeChanges: z.boolean().default(false),
  includeUntracked: z.boolean().default(false),
  pullRequestURL: z.string().url().max(2000).optional(),
  execution: executionSchema.optional(),
});
export const queuedInputSchema = z.object({
  requestOrigin: requestOriginSchema.optional(),
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  scheduledAt: z.string().datetime({ offset: true }).nullable().default(null),
});
export const pullRequestSchema = z.object({
  url: z.string().url(),
  number: z.number().int().positive(),
  title: z.string(),
  repository: z.string(),
  state: z.enum(["draft", "open", "merged", "closed"]),
  review: z.enum(["approved", "changes_requested", "required", "none"]),
  checks: z.enum(["passing", "failing", "pending", "none"]),
  checkRuns: z.array(
    z.object({
      name: z.string(),
      state: z.enum(["passing", "failing", "pending"]),
    }),
  ),
  conflicts: z.boolean(),
  head: z.string(),
  base: z.string(),
  syncedAt: z.string(),
  error: z.string().nullable(),
});
export type PullRequest = z.infer<typeof pullRequestSchema>;
export const projectPullRequestsSchema = z.object({
  repository: z.string().nullable(),
  pullRequests: z.array(pullRequestSchema),
  limited: z.boolean(),
});
export const pullRequestSourceSchema = z.object({
  url: z.string().url(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  number: z.number().int().positive(),
  headCommit: z.string().regex(/^[a-f0-9]{40}$/),
  baseCommit: z.string().regex(/^[a-f0-9]{40}$/),
});
export type PullRequestSource = z.infer<typeof pullRequestSourceSchema>;
export const taskSchema = z.object({
  tools: agentToolsSchema.default({ skillIds: null, mcpServerIds: null }),
  sandbox: sandboxSchema.nullable().default(null),
  remoteRevision: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .nullable()
    .default(null),
  includeUntracked: z.boolean().default(false),
  checkout: z
    .object({ path: z.string(), turnId: z.string(), createdAt: z.string() })
    .nullable()
    .default(null),
  effort: effortSchema.default(""),
  sessionProvider: providerSchema.nullable().default(null),
  source: pullRequestSourceSchema.nullable().default(null),
  pullRequests: z.array(pullRequestSchema).default([]),
  id: z.string(),
  projectId: z.string(),
  title: z.string(),
  provider: providerSchema,
  titleSource: z.enum(["prompt", "ai", "manual"]).default("manual"),
  presetId: z.string(),
  model: z.string(),
  status: statusSchema,
  sessionId: z.string().nullable(),
  baseCommit: z.string().nullable(),
  includeChanges: z.boolean(),
  pending: z.array(queuedInputSchema),
  activeTurnId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  archived: z.boolean(),
  error: z.string().nullable(),
  stopRequested: z.boolean(),
});
export type Task = z.infer<typeof taskSchema>;
export const changeSchema = z.object({
  path: z.string(),
  status: z.string(),
  additions: z.number(),
  deletions: z.number(),
});
export const taskMetadataSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^\r\n\x00-\x1f]+$/),
  promptSummary: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[^\r\n\x00-\x1f]+$/),
});
export type TaskMetadata = z.infer<typeof taskMetadataSchema>;
export const resultSchema = z.object({
  metadata: taskMetadataSchema.nullable().default(null),
  exitCode: z.number(),
  sessionId: z.string().nullable(),
  summary: z.string(),
  diff: z.string(),
  changes: z.array(changeSchema),
  verification: z
    .object({ command: z.string(), exitCode: z.number(), output: z.string() })
    .nullable(),
  baseCommit: z.string(),
  headCommit: z.string(),
  truncated: z.boolean().default(false),
});
export type RunResult = z.infer<typeof resultSchema>;
export const turnSchema = z.object({
  connectionId: z.string().nullable().optional(),
  requestOrigin: requestOriginSchema.optional(),
  check: z
    .object({ container: z.string(), command: z.string(), image: z.string() })
    .nullable()
    .default(null),
  sandbox: sandboxSchema.nullable().default(null),
  execution: executionSchema.nullable().default(null),
  id: z.string(),
  taskId: z.string(),
  inputId: z.string(),
  prompt: z.string(),
  status: z.enum(["preparing", "running", "finished", "failed", "paused"]),
  container: z.string(),
  cursor: z.number(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  result: resultSchema.nullable(),
});
export type Turn = z.infer<typeof turnSchema>;
export const eventSchema = z.object({
  repository: repositoryEventSchema.optional(),
  seq: z.number(),
  taskId: z.string().nullable(),
  turnId: z.string().nullable(),
  kind: z.enum(["user", "assistant", "activity", "system", "check", "error"]),
  text: z.string(),
  createdAt: z.string(),
});
export type TaskEvent = z.infer<typeof eventSchema>;
export const sidebarOrderSchema = z.object({
  projects: z.array(z.string()).default([]),
  tasks: z.record(z.string(), z.array(z.string())).default({}),
});
export type SidebarOrder = z.infer<typeof sidebarOrderSchema>;
export function ordered<T extends { id: string }>(items: T[], order: string[]) {
  const positions = new Map(order.map((id, index) => [id, index]));
  return [...items].sort(
    (a, b) =>
      (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity),
  );
}
export function reorder(
  ids: string[],
  id: string,
  overId: string,
  edge: "before" | "after",
) {
  if (id === overId || !ids.includes(id) || !ids.includes(overId)) return ids;
  const next = ids.filter((value) => value !== id);
  next.splice(next.indexOf(overId) + (edge === "after" ? 1 : 0), 0, id);
  return next;
}
export const settingsSchema = z.object({
  mcpServers: mcpServersSchema.default([]),
  skills: agentSkillsSchema.default([]),
  keybindings: shortcutBindingsSchema.default({}),
  sandbox: sandboxSchema.default(sandboxDefaults),
  sidebarOrder: sidebarOrderSchema.default({ projects: [], tasks: {} }),
  concurrency: z.number().int().min(1).max(4).default(2),
  appearance: z.enum(["light", "dark", "system"]).default("light"),
});
export type Settings = z.infer<typeof settingsSchema>;
const connectionSchema = z.object({
  ready: z.boolean(),
  source: z.string(),
  canImport: z.boolean(),
  canImportGateway: z.boolean().default(false),
  mode: z.enum(["direct", "gateway"]).default("direct"),
});
export const runtimeSchema = z.object({
  docker: z.boolean(),
  image: z.boolean(),
  building: z.boolean(),
  buildLog: z.string(),
  connections: z.object({
    codex: connectionSchema,
    claude: connectionSchema,
  }),
});
export type Runtime = z.infer<typeof runtimeSchema>;
export const snapshotSchema = z.object({
  projects: z.array(projectSchema),
  tasks: z.array(taskSchema),
  presets: z.array(presetSchema),
  notes: z.array(noteSchema),
  settings: settingsSchema,
  runtime: runtimeSchema,
  sequence: z.number(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
export const detailSchema = z.object({
  task: taskSchema,
  turns: z.array(turnSchema),
  events: z.array(eventSchema),
});
export type TaskDetail = z.infer<typeof detailSchema>;
export const labels: Record<TaskStatus, string> = {
  queued: "Queued",
  preparing: "Preparing",
  working: "Working",
  checking: "Checking",
  ready: "Ready to review",
  paused: "Paused",
  failed: "Needs attention",
  check_failed: "Check failed",
  complete: "Complete",
};
export const activeStatuses: TaskStatus[] = [
  "preparing",
  "working",
  "checking",
];
