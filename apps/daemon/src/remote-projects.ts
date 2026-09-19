import { z } from "zod";
import { checked } from "./config";
import { githubRepository } from "./pull-requests";

export function remoteRepository(input: string) {
  const value = input.trim();
  const repository = githubRepository(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
      ? `https://github.com/${value}`
      : value,
  );
  if (!repository)
    throw new Error("Enter a GitHub repository URL or owner/repository.");
  return repository;
}

export async function readRemoteProject(
  input: string,
  run = checked,
  requestedBranch?: string,
) {
  const requested = remoteRepository(input);
  try {
    const info = z
      .object({
        nameWithOwner: z.string(),
        defaultBranchRef: z.object({ name: z.string() }).nullable(),
        isEmpty: z.boolean(),
      })
      .parse(
        JSON.parse(
          await run([
            "gh",
            "repo",
            "view",
            requested,
            "--json",
            "nameWithOwner,defaultBranchRef,isEmpty",
          ]),
        ),
      );
    if (info.isEmpty || !info.defaultBranchRef)
      throw new Error(
        "The GitHub repository needs an initial commit before starting a task.",
      );
    const repository = remoteRepository(info.nameWithOwner);
    const branch = requestedBranch?.trim() || info.defaultBranchRef.name;
    if (branch.startsWith("-") || branch.includes("@{") || branch === "HEAD")
      throw new Error("Choose a valid branch name.");
    await checked(["git", "check-ref-format", "--branch", branch]);
    const refs = await run(
      [
        "git",
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!gh auth git-credential",
        "ls-remote",
        "--heads",
        `https://github.com/${repository}.git`,
        `refs/heads/${branch}`,
      ],
      { timeout: 30000 },
    );
    const head = refs
      .split("\n")
      .find((line) => line.endsWith(`\trefs/heads/${branch}`))
      ?.split("\t")[0];
    const headCommit = z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(head);
    return { path: "", repository, branch, headCommit };
  } catch (error) {
    if (error instanceof Error && error.message.includes("initial commit"))
      throw error;
    throw new Error(
      "Could not open this GitHub repository. Check its URL and your GitHub CLI access on this Mac.",
    );
  }
}
