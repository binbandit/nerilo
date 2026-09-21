import { z } from "zod";

export const githubAccountSelectionSchema = z.object({
  hostname: z
    .string()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/),
  login: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/),
});
export type GithubAccountSelection = z.infer<
  typeof githubAccountSelectionSchema
>;

// Project repositories and pull requests currently support github.com only.
export const githubAccountBindingSchema = githubAccountSelectionSchema.extend({
  hostname: z.literal("github.com"),
});

export const githubAccountsSchema = z.object({
  hosts: z.array(
    z.object({
      hostname: z.string(),
      environmentToken: z
        .enum([
          "GH_TOKEN",
          "GITHUB_TOKEN",
          "GH_ENTERPRISE_TOKEN",
          "GITHUB_ENTERPRISE_TOKEN",
        ])
        .nullable(),
      accounts: z.array(
        z.object({
          login: z.string(),
          active: z.boolean(),
          state: z.enum(["success", "error", "timeout"]),
        }),
      ),
    }),
  ),
});
export type GithubAccounts = z.infer<typeof githubAccountsSchema>;
