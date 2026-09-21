import type { PullRequest, Task } from "@nerilo/protocol";

type Workspace = Pick<
  Task,
  "id" | "projectId" | "updatedAt" | "archived" | "status"
> & {
  pullRequests: readonly Pick<PullRequest, "url">[];
};

export function pullRequestWorkspaces<T extends Workspace>(
  tasks: readonly T[],
  projectId: string,
  pr: Pick<PullRequest, "url" | "state">,
) {
  const linked = tasks
    .filter(
      (task) =>
        task.projectId === projectId &&
        task.pullRequests.some((item) => item.url === pr.url),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const latest = linked[0];
  const terminal = pr.state === "merged" || pr.state === "closed";
  const continuing = terminal
    ? undefined
    : linked.find((task) => !task.archived && task.status !== "complete");
  const preferred = terminal
    ? latest
    : (continuing ?? linked.find((task) => !task.archived) ?? latest);
  return { linked, latest, continuing, preferred };
}

export function matchesPullRequest(
  pr: Pick<PullRequest, "title" | "number" | "head" | "author">,
  query: string,
) {
  return `${pr.title} #${pr.number} ${pr.head} ${pr.author ? `@${pr.author}` : ""}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
