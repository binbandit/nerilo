import { z } from "zod";

export const workspacePathSchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(
    (path) =>
      !/[\x00-\x1f\x7f]/.test(path) &&
      path
        .split("/")
        .every(
          (part) =>
            part !== "" && part !== "." && part !== ".." && part !== ".git",
        ),
    "Choose a file inside this task workspace.",
  );
export const workspaceFilesSchema = z.object({
  files: z.array(workspacePathSchema).max(10000),
  truncated: z.boolean(),
});
export type WorkspaceFiles = z.infer<typeof workspaceFilesSchema>;
export const workspaceFileSchema = z.object({
  path: workspacePathSchema,
  content: z.string(),
  image: z.string().nullable(),
});
export type WorkspaceFile = z.infer<typeof workspaceFileSchema>;
