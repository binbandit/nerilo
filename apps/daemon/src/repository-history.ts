import { repositoryEventSchema, type RepositoryEvent } from "@nerilo/protocol";
import type { Store } from "./store";
import type { PullRequestObservation } from "./pr-observer";

export function captureRepositoryAction(
  store: Store,
  taskId: string,
  event: Pick<RepositoryEvent, "id" | "kind" | "summary"> &
    Partial<RepositoryEvent>,
  turnId: string | null = null,
) {
  return store.repositoryEvent(
    taskId,
    repositoryEventSchema.parse({
      occurredAt: new Date().toISOString(),
      timeSource: "nerilo",
      ...event,
    }),
    turnId,
  );
}

export function observationHistory(
  observation: PullRequestObservation,
): RepositoryEvent[] {
  const common = {
    prUrl: observation.url,
    headSha: observation.headSha,
    baseSha: observation.baseSha,
  };
  const entries: RepositoryEvent[] = [];
  for (const feedback of observation.feedback) {
    if (feedback.body.startsWith("<!-- nerilo:") && !feedback.actionable)
      continue;
    const status =
      feedback.state === "APPROVED"
        ? "approved"
        : feedback.state === "CHANGES_REQUESTED"
          ? "changes_requested"
          : null;
    entries.push(
      repositoryEventSchema.parse({
        ...common,
        id: `feedback:${feedback.fingerprint}`,
        kind: feedback.kind === "review" ? "review" : "feedback",
        summary:
          status === "approved"
            ? "approved the pull request"
            : status === "changes_requested"
              ? "requested changes"
              : feedback.kind === "review"
                ? "reviewed the pull request"
                : "left feedback",
        actor: feedback.author === "unknown" ? null : feedback.author,
        body: feedback.body.slice(0, 16000),
        url: feedback.url,
        occurredAt: feedback.updatedAt || observation.observedAt,
        timeSource: feedback.updatedAt ? "github" : "observed",
        status,
      }),
    );
  }
  if (observation.checksKnown) {
    // Jobs carry more useful names than their parent workflow, which reports the same result.
    const jobs = observation.checks.filter(
      (check) => !check.id.startsWith("run:"),
    );
    const checks = observation.checks.filter(
      (check) =>
        !check.id.startsWith("run:") ||
        !jobs.some(
          (job) => job.url && check.url && job.url.startsWith(`${check.url}/`),
        ),
    );
    for (const check of checks) {
      if (check.headSha !== observation.headSha) continue;
      entries.push(
        repositoryEventSchema.parse({
          ...common,
          id: `ci:${check.headSha}:${check.id}:${check.state}`,
          kind: "ci",
          summary:
            `${check.name} ${check.state === "passing" ? "passed" : check.state === "failing" ? "failed" : "pending"}`.slice(
              0,
              500,
            ),
          status: check.state,
          url: check.url || null,
          body: check.state === "failing" ? check.details.slice(0, 16000) : "",
          occurredAt: check.updatedAt || observation.observedAt,
          timeSource: check.updatedAt ? "github" : "observed",
        }),
      );
    }
  }
  if (
    observation.state === "OPEN" &&
    observation.behindBy &&
    observation.behindBy > 0
  )
    entries.push(
      repositoryEventSchema.parse({
        ...common,
        id: `base:${observation.headSha}:${observation.baseSha}`,
        kind: "base-update",
        summary: `${observation.baseBranch} is ${observation.behindBy} ${observation.behindBy === 1 ? "commit" : "commits"} ahead`,
        url: observation.url,
        body: observation.baseUpdate.reason,
        occurredAt: observation.observedAt,
        timeSource: "observed",
      }),
    );
  if (observation.state !== "OPEN")
    entries.push(
      repositoryEventSchema.parse({
        ...common,
        id: `pr:${observation.url}:${observation.state}`,
        kind: observation.state === "MERGED" ? "merged" : "closed",
        summary:
          observation.state === "MERGED"
            ? "Pull request merged"
            : "Pull request closed",
        url: observation.url,
        occurredAt: observation.observedAt,
        timeSource: "observed",
      }),
    );
  return entries;
}

export function captureObservation(
  store: Store,
  taskId: string,
  observation: PullRequestObservation,
) {
  const entries = observationHistory(observation);
  store.transaction(() => {
    for (const entry of entries) store.repositoryEvent(taskId, entry);
  });
  return entries;
}

export function repairOrigin(observation: PullRequestObservation) {
  const changed = new Set(
    observation.events
      .filter((event) => event.actionable)
      .map((event) => event.id),
  );
  const authors = [
    ...new Set(
      observation.feedback
        .filter(
          (feedback) =>
            feedback.actionable && changed.has(feedback.fingerprint),
        )
        .map((feedback) => feedback.author)
        .filter((author) => author && author !== "unknown"),
    ),
  ];
  const action =
    observation.decision.action === "update-base"
      ? ("update-base" as const)
      : ("repair" as const);
  const summary =
    action === "update-base"
      ? "Update branch to latest base"
      : authors.length
        ? `Address ${authors.slice(0, 2).join(" and ")}${authors.length > 2 ? " and others" : ""}'s PR feedback`
        : observation.events.some((event) => event.kind === "ci-failure")
          ? "Fix failing PR checks"
          : "Address PR feedback and checks";
  const triggerEventIds = observationHistory(observation)
    .filter((event) =>
      event.kind === "feedback" || event.kind === "review"
        ? changed.has(event.id.slice("feedback:".length))
        : event.kind === "ci"
          ? event.status === "failing"
          : event.kind === "base-update",
    )
    .map((event) => event.id)
    .slice(0, 200);
  return {
    kind: "autopilot" as const,
    action,
    summary: summary.slice(0, 180),
    triggerEventIds,
  };
}
