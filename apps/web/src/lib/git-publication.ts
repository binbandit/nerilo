import type { GitRemoteStatus, GitStatus } from "@nerilo/protocol";

export function gitPublication(
  status: Pick<GitStatus, "head" | "branch">,
  remote: GitRemoteStatus | null,
) {
  const current =
    remote?.head === status.head && remote.branch === status.branch
      ? remote
      : null;
  const count = (value: number | null) =>
    `${value ?? 0} ${(value ?? 0) === 1 ? "commit" : "commits"}`;
  return {
    state: current?.state ?? "checking",
    canPush: current?.state === "unpublished" || current?.state === "ahead",
    canOpenPR:
      current?.state === "synced" && current.remoteHead === status.head,
    title: !current
      ? "Checking GitHub…"
      : {
          unpublished: "Branch not published",
          synced: "Up to date with GitHub",
          ahead: `${count(current.ahead)} to push`,
          behind: `${count(current.behind)} behind GitHub`,
          diverged: "Branch has diverged",
          unavailable: "Could not check GitHub",
        }[current.state],
    detail: !current
      ? ""
      : {
          unpublished: "",
          synced: "",
          ahead: "",
          behind: "Review the remote changes before publishing.",
          diverged: `${count(current.ahead)} local · ${count(current.behind)} on GitHub. Reconcile the branches before publishing.`,
          unavailable: current.error ?? "Check your connection and try again.",
        }[current.state],
    remoteHead: current?.remoteHead ?? null,
  };
}
