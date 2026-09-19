import { z } from "zod";

const repositorySchema = z
  .string()
  .regex(
    /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/,
    "Use a GitHub repository such as owner/repository.",
  )
  .refine((value) => ![".", ".."].includes(value.split("/")[1]));
const revisionSchema = z
  .string()
  .regex(/^[a-f0-9]{40}$/, "Choose a discovered GitHub revision.");
const directorySchema = z
  .string()
  .max(220)
  .refine(
    (value) =>
      value === "" ||
      (!/[\\\x00-\x1f\x7f:]/.test(value) &&
        value
          .split("/")
          .every(
            (part) =>
              Boolean(part) && part !== "." && part !== ".." && part !== ".git",
          )),
    "Use a relative skill folder path.",
  );
export const githubSkillDiscoverSchema = z
  .object({
    url: z.string().trim().min(1).max(400),
    ref: z
      .string()
      .trim()
      .min(1)
      .max(250)
      .refine((value) => !/[\x00-\x1f\x7f]/.test(value))
      .optional(),
  })
  .strict();
export const githubSkillDiscoverySchema = z.object({
  repository: repositorySchema,
  revision: revisionSchema,
  skills: z
    .array(z.object({ path: directorySchema, name: z.string().optional() }))
    .max(200),
});
export type GithubSkillDiscovery = z.infer<typeof githubSkillDiscoverySchema>;
export const githubSkillImportSchema = z
  .object({
    repository: repositorySchema,
    revision: revisionSchema,
    path: directorySchema,
  })
  .strict();

export function githubSkillRepository(value: string) {
  let repository = value.trim();
  if (repository.includes("://")) {
    let url: URL;
    try {
      url = new URL(repository);
    } catch {
      throw new Error("Use a GitHub repository URL or owner/repository.");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "github.com" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Use an HTTPS github.com repository URL.");
    repository = url.pathname.replace(/^\//, "").replace(/\/$/, "");
  }
  repository = repository.replace(/\.git$/, "");
  const parsed = repositorySchema.safeParse(repository);
  if (!parsed.success)
    throw new Error(
      "Use owner/repository or its GitHub URL. Enter a branch or tag separately.",
    );
  return parsed.data;
}
