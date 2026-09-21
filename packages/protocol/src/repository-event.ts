import { z } from "zod";

export const repositoryEventSchema = z.object({
  id: z.string(),
  kind: z.enum([
    "feedback",
    "review",
    "ci",
    "base-update",
    "published",
    "pr-opened",
    "pr-linked",
    "merged",
    "closed",
    "branch",
    "commit",
  ]),
  summary: z.string().max(500),
  actor: z.string().nullable().default(null),
  body: z.string().max(16000).default(""),
  url: z.string().nullable().default(null),
  prUrl: z.string().nullable().default(null),
  headSha: z.string().nullable().default(null),
  baseSha: z.string().nullable().default(null),
  evidenceVersion: z.literal(2).optional(),
  observedHeadSha: z.string().nullable().optional(),
  observedBaseSha: z.string().nullable().optional(),
  observedAt: z.string().optional(),
  occurredAt: z.string(),
  timeSource: z.enum(["github", "nerilo", "observed"]),
  status: z
    .enum(["pending", "passing", "failing", "approved", "changes_requested"])
    .nullable()
    .default(null),
});
export type RepositoryEvent = z.infer<typeof repositoryEventSchema>;
