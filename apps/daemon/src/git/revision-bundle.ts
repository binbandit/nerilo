import { join } from "node:path";
import { checked } from "../platform/config";

/** Build a self-contained snapshot without changing the user's checkout or refs. */
export async function bundleRevision(
  remote: string,
  revision: { headCommit: string; baseCommit: string },
  directory: string,
) {
  const repository = join(directory, "source.git");
  await checked(["git", "init", "--bare", repository]);
  await checked(
    [
      "git",
      "-C",
      repository,
      "-c",
      "credential.helper=",
      "-c",
      "credential.helper=!gh auth git-credential",
      "fetch",
      "--no-tags",
      "--",
      remote,
      revision.headCommit,
      revision.baseCommit,
    ],
    { timeout: 120000 },
  );
  await checked([
    "git",
    "-C",
    repository,
    "update-ref",
    "refs/heads/nerilo-task",
    revision.headCommit,
  ]);
  await checked([
    "git",
    "-C",
    repository,
    "update-ref",
    "refs/heads/nerilo-base",
    revision.baseCommit,
  ]);
  await checked([
    "git",
    "-C",
    repository,
    "symbolic-ref",
    "HEAD",
    "refs/heads/nerilo-task",
  ]);
  await checked(
    [
      "git",
      "-C",
      repository,
      "bundle",
      "create",
      join(directory, "source.bundle"),
      "HEAD",
      "refs/heads/nerilo-task",
      "refs/heads/nerilo-base",
    ],
    { timeout: 120000 },
  );
}
