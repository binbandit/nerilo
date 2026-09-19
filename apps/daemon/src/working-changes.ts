import { join } from "node:path";
import { checked, command } from "./config";

/** Capture the working files using a separate index; never stage the user's files. */
export async function workingChanges(
  repository: string,
  directory: string,
  includeUntracked: boolean,
) {
  const options = {
    env: { GIT_INDEX_FILE: join(directory, "snapshot-index") },
  };
  const git = ["git", "-C", repository];
  await checked([...git, "read-tree", "HEAD"], options);
  await checked(
    [...git, "add", includeUntracked ? "-A" : "-u", "--", "."],
    options,
  );
  const patch = await command(
    [
      ...git,
      "diff",
      "--cached",
      "--binary",
      "--no-ext-diff",
      "--no-textconv",
      "HEAD",
    ],
    options,
  );
  if (patch.code) throw new Error(patch.stderr);
  return patch.stdout;
}

export async function bundleWorkingChanges(
  repository: string,
  directory: string,
  head: string,
  includeUntracked: boolean,
) {
  const patch = await workingChanges(repository, directory, includeUntracked);
  const copy = join(directory, "working-copy");
  await checked([
    "git",
    "clone",
    "--no-hardlinks",
    "--no-checkout",
    "--",
    repository,
    copy,
  ]);
  const git = ["git", "-C", copy];
  await checked([...git, "checkout", "--detach", head]);
  if (patch) {
    await checked([...git, "apply", "--index", "--binary", "-"], {
      input: patch,
    });
    await checked([
      ...git,
      "-c",
      "user.name=Nerilo",
      "-c",
      "user.email=snapshot@nerilo.local",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-m",
      "Local working snapshot",
    ]);
  }
  await checked([
    ...git,
    "bundle",
    "create",
    join(directory, "source.bundle"),
    "HEAD",
  ]);
  return checked([...git, "rev-parse", "HEAD"]);
}
