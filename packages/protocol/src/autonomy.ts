import { z } from "zod";
export const autonomyModeSchema = z.enum(["off", "pr", "merge"]);
export const autonomySchema = z.object({
  taskId: z.string(),
  mode: autonomyModeSchema,
  status: z.enum([
    "off",
    "waiting",
    "working",
    "publishing",
    "reviewing",
    "blocked",
    "merged",
    "closed",
  ]),
  branch: z.string(),
  base: z.string(),
  prUrl: z.string().nullable(),
  detail: z.string(),
  repairTurns: z.number(),
  updatedAt: z.string(),
});
export type Autonomy = z.infer<typeof autonomySchema>;
