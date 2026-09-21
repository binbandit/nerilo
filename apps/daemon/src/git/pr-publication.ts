import { z } from "zod";
import { checked } from "../platform/config";

const targetSchema = z.object({
  state: z.enum(["open", "closed"]),
  head: z.object({
    ref: z.string(),
    sha: z.string().regex(/^[a-f0-9]{40}$/),
    repo: z.object({ full_name: z.string() }).nullable(),
  }),
  base: z.object({
    ref: z.string(),
    repo: z.object({ full_name: z.string() }),
  }),
});

export async function readPublicationTarget(
  repository: string,
  number: number,
  remote = checked,
) {
  return targetSchema.parse(
    JSON.parse(
      await remote([
        "gh",
        "api",
        "--method",
        "GET",
        `repos/${repository}/pulls/${number}`,
      ]),
    ),
  );
}

export function requireSameRepositoryPR(
  target: z.infer<typeof targetSchema>,
  repository: string,
  branch: string,
) {
  if (target.state !== "open")
    throw new Error(
      "This pull request is closed. Start a separate task to publish new work.",
    );
  if (
    target.head.repo?.full_name.toLowerCase() !== repository.toLowerCase() ||
    target.base.repo.full_name.toLowerCase() !== repository.toLowerCase()
  )
    throw new Error(
      "This pull request uses a fork. Publish from the contributor's repository; Nerilo will not push its branch into another repository.",
    );
  if (target.head.ref !== branch)
    throw new Error(
      "The pull request branch changed. Refresh its context before publishing.",
    );
}
