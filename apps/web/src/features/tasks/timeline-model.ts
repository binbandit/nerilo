import {
  autopilotPromptPrefix,
  repositoryEventSchema,
  type RepositoryEvent,
  type TaskEvent,
  type Turn,
} from "@nerilo/protocol";

export type TimelineItem =
  | { kind: "turn"; id: string; at: string; turn: Turn; index: number }
  | { kind: "repository"; id: string; at: string; event: RepositoryEvent };

export type TimelineGroup = {
  kind: "repository-group";
  id: string;
  at: string;
  group: "base-update" | "review";
  events: RepositoryEvent[];
};

// Group observations for display only. Every original revision, timestamp, and
// GitHub discussion remains available in the expanded history.
export function groupTimeline(
  items: TimelineItem[],
): (TimelineItem | TimelineGroup)[] {
  const grouped: (TimelineItem | TimelineGroup)[] = [];
  const baseObservations = new Map<string, { key: string; index: number }>();
  for (const item of items) {
    if (item.kind === "turn") {
      baseObservations.clear();
      grouped.push(item);
      continue;
    }
    const event = item.event;
    if (event.kind === "merged" || event.kind === "closed")
      baseObservations.clear();
    if (event.kind === "base-update" && event.prUrl) {
      const key = JSON.stringify([
        event.prUrl,
        event.summary,
        event.body,
        event.baseSha,
        event.status,
      ]);
      const observed = baseObservations.get(event.prUrl);
      const previous =
        observed?.key === key ? grouped[observed.index] : undefined;
      if (observed && previous && previous.kind !== "turn") {
        const previousEvents =
          previous.kind === "repository-group"
            ? previous.events
            : [previous.event];
        grouped.splice(observed.index, 1);
        for (const other of baseObservations.values())
          if (other.index > observed.index) other.index--;
        baseObservations.set(event.prUrl, { key, index: grouped.length });
        grouped.push({
          kind: "repository-group",
          id: item.id,
          at: item.at,
          group: "base-update",
          events: [...previousEvents, event],
        });
        continue;
      }
      baseObservations.set(event.prUrl, { key, index: grouped.length });
    }
    const previous = grouped.at(-1);
    if (
      (event.kind === "review" || event.kind === "feedback") &&
      event.actor &&
      event.prUrl &&
      previous &&
      previous.kind !== "turn"
    ) {
      const previousEvents =
        previous.kind === "repository-group"
          ? previous.events
          : [previous.event];
      const last = previousEvents.at(-1)!;
      const reviewCount =
        previousEvents.filter((entry) => entry.kind === "review").length +
        (event.kind === "review" ? 1 : 0);
      if (
        previousEvents.every(
          (entry) => entry.kind === "review" || entry.kind === "feedback",
        ) &&
        reviewCount <= 1 &&
        last.actor === event.actor &&
        last.prUrl === event.prUrl &&
        last.headSha === event.headSha &&
        Math.abs(Date.parse(last.occurredAt) - Date.parse(event.occurredAt)) <=
          300000
      ) {
        grouped[grouped.length - 1] = {
          kind: "repository-group",
          id: previous.id,
          at: previous.at,
          group: "review",
          events: [...previousEvents, event],
        };
        continue;
      }
    }
    grouped.push(item);
  }
  return grouped;
}

function legacyPromptHistory(turn: Turn): RepositoryEvent[] {
  if (!turn.prompt.startsWith(`${autopilotPromptPrefix}\n\n`)) return [];
  const header = turn.prompt.split(
    /\n\n(?:Feedback |Failing check |Unresolved thread )/,
  )[0];
  const prUrl =
    /^Pull request: (https:\/\/github\.com\/[^\s]+\/pull\/\d+)$/m.exec(
      header,
    )?.[1] ?? null;
  if (!prUrl) return [];
  const entries: RepositoryEvent[] = [];
  for (const match of header.matchAll(
    /^Event ((?:comment|review|review-comment):[^\s]+): (comment|review|review-comment) by ([a-z\d_-]+(?:\[bot\])?): ([^\n]*)/gim,
  )) {
    const [, fingerprint, kind, actor, excerpt] = match;
    const id = fingerprint.slice(0, fingerprint.lastIndexOf(":"));
    const start = turn.prompt.indexOf(`\n\nFeedback ${id} (`);
    const section =
      start < 0
        ? ""
        : turn.prompt
            .slice(start + 2)
            .split(/\n\n(?:Feedback |Failing check |Unresolved thread )/)[0];
    const url =
      /^Feedback [^\s]+ \((https:\/\/github\.com\/[^\s)]+)\)/.exec(
        section,
      )?.[1] ?? prUrl;
    const body = section.includes(":\n")
      ? section.slice(section.indexOf(":\n") + 2)
      : excerpt;
    entries.push(
      repositoryEventSchema.parse({
        id: `feedback:${fingerprint}`,
        kind: kind === "review" ? "review" : "feedback",
        summary: kind === "review" ? "left a review" : "left feedback",
        actor,
        body: body.slice(0, 16000),
        url,
        prUrl,
        occurredAt: turn.startedAt,
        timeSource: "observed",
      }),
    );
  }
  const failed = [
    ...header.matchAll(
      /^Event ci:([0-9a-f]{40}):(check:\d+|run:\d+:\d+):[^\n]+: (.+) failed on [0-9a-f]{40}\.$/gm,
    ),
  ];
  for (const match of failed.filter(
    (entry) =>
      !entry[2].startsWith("run:") ||
      !failed.some((other) => other[2].startsWith("check:")),
  )) {
    const [, headSha, id, name] = match;
    const line = turn.prompt
      .split("\n")
      .find((text) =>
        text.startsWith(`Failing check ${name}: https://github.com/`),
      );
    entries.push(
      repositoryEventSchema.parse({
        id: `ci:${headSha}:${id}:failing`,
        kind: "ci",
        summary: `${name} failed`,
        status: "failing",
        headSha,
        url: line?.slice(`Failing check ${name}: `.length) ?? prUrl,
        prUrl,
        occurredAt: turn.startedAt,
        timeSource: "observed",
      }),
    );
  }
  return entries;
}

const legacyLabels: Record<
  string,
  { kind: RepositoryEvent["kind"]; summary: string }
> = {
  "Published the task changes. Waiting for PR checks and feedback.": {
    kind: "published",
    summary: "Published changes",
  },
  "Pushed the task branch.": {
    kind: "published",
    summary: "Pushed the task branch",
  },
  "Opened the task pull request.": {
    kind: "pr-opened",
    summary: "Pull request opened",
  },
  "Created a local branch.": { kind: "branch", summary: "Created a branch" },
  "Committed the reviewed checkout changes.": {
    kind: "commit",
    summary: "Committed changes",
  },
  "Updating the task branch against its base.": {
    kind: "base-update",
    summary: "Branch update requested",
  },
  "Pull request merged.": { kind: "merged", summary: "Pull request merged" },
  "Checks and review requirements passed. Pull request squash-merged.": {
    kind: "merged",
    summary: "Pull request squash-merged",
  },
  "Pull request closed.": { kind: "closed", summary: "Pull request closed" },
};

function isLegacyPublicationNoop(
  status: TaskEvent,
  turns: Turn[],
  events: TaskEvent[],
) {
  if (
    status.text !==
    "Published the task changes. Waiting for PR checks and feedback."
  )
    return false;
  const completed = turns
    .filter(
      (turn) =>
        turn.status === "finished" &&
        turn.endedAt &&
        Date.parse(turn.endedAt) <= Date.parse(status.createdAt),
    )
    .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))[0];
  const result = completed?.result;
  if (
    !completed ||
    !result ||
    result.diff !== "" ||
    result.truncated ||
    !result.headCommit ||
    result.baseCommit !== result.headCommit
  )
    return false;
  return events.some(
    (event) =>
      event.repository?.kind === "published" &&
      event.repository.headSha === result.headCommit &&
      Date.parse(event.repository.occurredAt) <
        Date.parse(completed.startedAt) &&
      Date.parse(event.createdAt) < Date.parse(completed.startedAt),
  );
}

export function taskTimeline(
  turns: Turn[],
  events: TaskEvent[],
): TimelineItem[] {
  const orderedTurns = [...turns].sort(
    (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
  );
  const repositories = new Map<
    string,
    { event: RepositoryEvent; at: string }
  >();
  for (const event of events) {
    if (event.repository)
      repositories.set(event.repository.id, {
        event: event.repository,
        at: event.repository.occurredAt || event.createdAt,
      });
  }
  for (const turn of orderedTurns)
    for (const event of legacyPromptHistory(turn))
      if (!repositories.has(event.id))
        repositories.set(event.id, { event, at: turn.startedAt });
  const knownPRs = new Set(
    [...repositories.values()]
      .map((entry) => entry.event.prUrl)
      .filter((url) => url !== null),
  );
  const legacyMerges = events.filter(
    (event) =>
      !event.repository &&
      event.kind === "system" &&
      legacyLabels[event.text]?.kind === "merged",
  );
  for (const event of events) {
    if (event.repository || event.kind !== "system") continue;
    const label = legacyLabels[event.text];
    if (!label) continue;
    if (isLegacyPublicationNoop(event, orderedTurns, events)) continue;
    const merged =
      label.kind === "merged" &&
      legacyMerges.length === 1 &&
      knownPRs.size === 1
        ? [...repositories.values()].filter(
            (entry) =>
              entry.event.kind === "merged" &&
              entry.event.prUrl &&
              knownPRs.has(entry.event.prUrl),
          )
        : [];
    const originalMerge = merged.length === 1 ? merged[0] : null;
    if (
      !originalMerge &&
      [...repositories.values()].some(
        (existing) =>
          existing.event.kind === label.kind &&
          Math.abs(Date.parse(existing.at) - Date.parse(event.createdAt)) <
            5000,
      )
    )
      continue;
    const repository = repositoryEventSchema.parse({
      ...(originalMerge?.event ?? {}),
      id: originalMerge?.event.id ?? `legacy:${event.seq}`,
      ...label,
      occurredAt: event.createdAt,
      timeSource: "nerilo",
    });
    if (
      event.text ===
        "Checks and review requirements passed. Pull request squash-merged." &&
      ![...repositories.values()].some(
        (existing) =>
          existing.event.kind === "ci" &&
          existing.event.status === "passing" &&
          Math.abs(Date.parse(existing.at) - Date.parse(event.createdAt)) <
            300000,
      )
    ) {
      const verified = repositoryEventSchema.parse({
        id: `legacy:requirements:${event.seq}`,
        kind: "ci",
        summary: "Checks and review requirements passed",
        status: "passing",
        occurredAt: event.createdAt,
        timeSource: "nerilo",
      });
      repositories.set(verified.id, { event: verified, at: event.createdAt });
    }
    repositories.set(repository.id, { event: repository, at: event.createdAt });
  }
  const items: TimelineItem[] = orderedTurns.map((turn, index) => ({
    kind: "turn" as const,
    id: `turn:${turn.id}`,
    at: turn.startedAt,
    turn,
    index,
  }));
  const mergedAt = new Map<string, number>();
  for (const entry of repositories.values())
    if (entry.event.kind === "merged" && entry.event.prUrl)
      mergedAt.set(
        entry.event.prUrl,
        Math.min(
          mergedAt.get(entry.event.prUrl) ?? Infinity,
          Date.parse(entry.at),
        ),
      );
  for (const entry of repositories.values()) {
    if (
      entry.event.kind === "base-update" &&
      entry.event.prUrl &&
      Date.parse(entry.at) >= (mergedAt.get(entry.event.prUrl) ?? Infinity)
    )
      continue;
    const cause = orderedTurns.find(
      (turn) =>
        turn.requestOrigin?.kind === "autopilot" &&
        turn.requestOrigin.triggerEventIds?.includes(entry.event.id),
    );
    const at =
      cause && Date.parse(entry.at) > Date.parse(cause.startedAt)
        ? cause.startedAt
        : entry.at;
    items.push({
      kind: "repository",
      id: entry.event.id,
      at,
      event: entry.event,
    });
  }
  const priority = { repository: 0, turn: 1 };
  return items.sort(
    (a, b) =>
      Date.parse(a.at) - Date.parse(b.at) ||
      priority[a.kind] - priority[b.kind],
  );
}
