import type { GitRemoteStatus } from "@nerilo/protocol";
import { checked, command } from "../platform/config";

type Comparison = {
  path: string;
  branch: string;
  head: string;
  remote: string;
};

export function unavailableRemoteStatus(
  local: Pick<Comparison, "branch" | "head">,
  error: string,
): GitRemoteStatus {
  return {
    branch: local.branch,
    head: local.head,
    remoteHead: null,
    state: "unavailable",
    ahead: null,
    behind: null,
    checkedAt: new Date().toISOString(),
    error,
  };
}

// Fetch objects only: no local branch, tracking ref, FETCH_HEAD, or index changes.
export async function compareGitRemote(
  local: Comparison,
  network = { checked },
): Promise<GitRemoteStatus> {
  const { path, branch, head, remote } = local;
  const git = ["git", "-C", path];
  const networkGit = [
    ...git,
    "-c",
    "credential.helper=",
    "-c",
    "credential.helper=!gh auth git-credential",
  ];
  const options = { timeout: 60000, env: { GIT_NO_REPLACE_OBJECTS: "1" } };
  const unavailable = (error: string) => unavailableRemoteStatus(local, error);
  const current = async () => {
    const currentBranch = await checked([
      ...git,
      "symbolic-ref",
      "--short",
      "HEAD",
    ]);
    const currentHead = await checked([...git, "rev-parse", "HEAD"]);
    return currentBranch === branch && currentHead === head;
  };
  const readRemote = async () => {
    const output = await network.checked(
      [...networkGit, "ls-remote", "--heads", remote, `refs/heads/${branch}`],
      options,
    );
    if (!output.trim()) return null;
    const lines = output.trim().split("\n");
    const match = lines[0].match(/^([a-f0-9]{40}|[a-f0-9]{64})\s+(.+)$/);
    if (lines.length !== 1 || !match || match[2] !== `refs/heads/${branch}`)
      throw new Error("Unexpected remote response.");
    return match[1];
  };
  try {
    if (!(await current()))
      return unavailable("The checkout changed. Refresh and try again.");
    const remoteHead = await readRemote();
    let ahead: number | null = null;
    let behind: number | null = null;
    let state: GitRemoteStatus["state"] = "unpublished";
    if (remoteHead === head) {
      state = "synced";
      ahead = 0;
      behind = 0;
    } else if (remoteHead) {
      if (
        (await checked([...git, "rev-parse", "--is-shallow-repository"])) ===
        "true"
      )
        return unavailable(
          "This checkout has incomplete history. A full checkout is needed to compare branches.",
        );
      const object = await command(
        [...git, "cat-file", "-e", `${remoteHead}^{commit}`],
        options,
      );
      if (object.code)
        await network.checked(
          [
            ...networkGit,
            "fetch",
            "--no-write-fetch-head",
            "--no-tags",
            "--no-recurse-submodules",
            "--no-auto-maintenance",
            "--refmap=",
            remote,
            remoteHead,
          ],
          options,
        );
      const counts = await checked(
        [
          ...git,
          "rev-list",
          "--left-right",
          "--count",
          `${head}...${remoteHead}`,
        ],
        options,
      );
      const match = counts.match(/^(\d+)\s+(\d+)$/);
      if (!match) throw new Error("Unexpected comparison result.");
      ahead = Number(match[1]);
      behind = Number(match[2]);
      state = ahead && behind ? "diverged" : behind ? "behind" : "ahead";
    }
    if ((await readRemote()) !== remoteHead)
      return unavailable(
        "The remote branch changed during the check. Try again.",
      );
    if (!(await current()))
      return unavailable("The checkout changed. Refresh and try again.");
    return {
      branch,
      head,
      remoteHead,
      state,
      ahead,
      behind,
      checkedAt: new Date().toISOString(),
      error: null,
    };
  } catch {
    return unavailable(
      "Check your connection and GitHub sign-in, then try again.",
    );
  }
}
