import type { PullRequest, Task } from "@nerilo/protocol";

export function pullRequestReadiness(pr: PullRequest, expectedHead?: string) {
  const terminal = pr.state === "merged" || pr.state === "closed";
  if (!terminal && expectedHead && pr.headSha !== expectedHead) {
    return {
      blockers: pr.error ? ["GitHub status unavailable"] : [],
      waiting: ["Waiting for GitHub status on the pushed revision"],
      headline: pr.error
        ? "GitHub status unavailable"
        : "Waiting for GitHub status",
      tone: pr.error ? ("attention" as const) : ("neutral" as const),
    };
  }
  const blockers: string[] = [];
  const waiting: string[] = [];
  if (!terminal) {
    if (pr.conflicts) blockers.push(`Conflicts with ${pr.base}`);
    if (pr.review === "changes_requested") blockers.push("Changes requested");
    if (pr.checks === "failing") blockers.push("GitHub checks failing");
    if (pr.state === "draft") waiting.push("Draft PR");
    if (pr.review === "required") waiting.push("Review required");
    if (pr.checks === "pending") waiting.push("GitHub checks running");
    if (pr.checks === "none") waiting.push("No GitHub checks on this revision");
  }
  if (pr.error) blockers.unshift("GitHub status unavailable");
  const headline =
    blockers[0] ??
    (pr.state === "merged"
      ? "Merged"
      : pr.state === "closed"
        ? "Closed"
        : (waiting[0] ??
          (pr.review === "approved" ? "Approved" : "Awaiting review")));
  const tone: "neutral" | "attention" | "success" = blockers.length
    ? "attention"
    : pr.state === "merged"
      ? "success"
      : "neutral";
  return { blockers, waiting, headline, tone };
}

export function taskCanCompleteMergedPR(task: Task) {
  return (
    !task.archived &&
    !task.activeTurnId &&
    !task.pending.length &&
    ["ready", "check_failed"].includes(task.status) &&
    task.pullRequests.some((pr) => pr.state === "merged") &&
    task.pullRequests.every(
      (pr) => pr.state === "merged" || pr.state === "closed",
    )
  );
}
