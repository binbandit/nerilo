import { z } from "zod";

// JSON escaping can use six bytes per description character.
export const GIT_REQUEST_LIMIT = 400000;

export const gitDraftSchema = z.object({
  branch: z.string().trim().min(1).max(180),
  commitTitle: z.string().trim().min(1).max(300),
  prTitle: z.string().trim().min(1).max(300),
  prBody: z.string().max(60000),
});
export type GitDraft = z.infer<typeof gitDraftSchema>;
export const pullRequestTemplatesSchema = z.array(
  z.object({ path: z.string(), body: gitDraftSchema.shape.prBody }),
);
export type PullRequestTemplate = z.infer<
  typeof pullRequestTemplatesSchema
>[number];
export const checkoutPullRequestSchema = z.object({
  url: z.string().url(),
  number: z.number().int().positive(),
  repository: z.string(),
  branch: z.string(),
  expectedHead: z.string().regex(/^[a-f0-9]{40}$/),
});
export const gitStatusSchema = z.object({
  path: z.string(),
  turnId: z.string(),
  branch: z.string(),
  baseBranch: z.string(),
  baseCommit: z.string().optional(),
  preservesHistory: z.boolean().optional(),
  pullRequest: checkoutPullRequestSchema.nullable().optional(),
  head: z.string(),
  reviewToken: z.string(),
  dirty: z.boolean(),
  files: z.string(),
  patch: z.string(),
  truncated: z.boolean(),
  commits: z.number(),
  repository: z.string().nullable(),
  publishBlocked: z.string().nullable(),
  draft: gitDraftSchema,
});
export type GitStatus = z.infer<typeof gitStatusSchema>;
export const gitRemoteStatusSchema = z.object({
  branch: z.string(),
  head: z.string(),
  remoteHead: z.string().nullable(),
  state: z.enum([
    "unpublished",
    "synced",
    "ahead",
    "behind",
    "diverged",
    "unavailable",
  ]),
  ahead: z.number().int().nonnegative().nullable(),
  behind: z.number().int().nonnegative().nullable(),
  checkedAt: z.string(),
  error: z.string().nullable(),
});
export type GitRemoteStatus = z.infer<typeof gitRemoteStatusSchema>;
const review = { turnId: z.string(), reviewToken: z.string() };
export const gitActionSchema = z.discriminatedUnion("action", [
  z.object({
    ...review,
    action: z.literal("branch"),
    branch: gitDraftSchema.shape.branch,
  }),
  z.object({
    ...review,
    action: z.literal("commit"),
    message: z.string().trim().min(1).max(12000),
  }),
  z.object({ ...review, action: z.literal("push") }),
  z.object({
    ...review,
    action: z.literal("pull-request"),
    title: gitDraftSchema.shape.prTitle,
    body: gitDraftSchema.shape.prBody,
    base: z.string().trim().min(1).max(180),
  }),
]);
export type GitAction = z.infer<typeof gitActionSchema>;
