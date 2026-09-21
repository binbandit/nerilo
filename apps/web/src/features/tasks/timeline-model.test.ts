import { expect, test } from "bun:test";
import {
  autopilotPromptPrefix,
  eventSchema,
  repositoryEventSchema,
  resultSchema,
  turnSchema,
} from "@nerilo/protocol";
import {
  groupTimeline,
  taskTimeline,
  type TimelineItem,
} from "@/features/tasks/timeline-model";

const turn = (id: string, at: string) =>
  turnSchema.parse({
    id,
    taskId: "task",
    inputId: id,
    prompt: "Do the work",
    status: "finished",
    container: "fake",
    cursor: 0,
    startedAt: at,
    endedAt: at,
    result: null,
  });
test("timeline sorts imported turns and keeps triggering feedback before its agent", () => {
  const early = turn("early", "2026-09-10T12:00:00Z");
  const late = turnSchema.parse({
    ...turn("late", "2026-09-10T12:10:00Z"),
    requestOrigin: {
      kind: "autopilot",
      action: "repair",
      triggerEventIds: ["feedback:1"],
    },
  });
  const feedback = eventSchema.parse({
    seq: 1,
    taskId: "task",
    turnId: null,
    kind: "system",
    text: "Feedback",
    createdAt: "2026-09-10T12:20:00Z",
    repository: repositoryEventSchema.parse({
      id: "feedback:1",
      kind: "feedback",
      summary: "left feedback",
      actor: "Tony",
      occurredAt: "2026-09-10T12:20:00Z",
      timeSource: "github",
    }),
  });
  expect(
    taskTimeline([late, early], [feedback]).map((item) => item.id),
  ).toEqual(["turn:early", "feedback:1", "turn:late"]);
});

test("repeated base observations retain revision evidence after the intervening push", () => {
  const observation = (
    id: string,
    headSha: string,
  ): Extract<TimelineItem, { kind: "repository" }> => ({
    kind: "repository",
    id,
    at: "2026-09-20T12:00:00Z",
    event: repositoryEventSchema.parse({
      id,
      kind: "base-update",
      summary: "main is 2 commits ahead",
      body: "Integrate the newer base.",
      prUrl: "https://github.com/team/repo/pull/4",
      headSha,
      baseSha: "base",
      occurredAt: "2026-09-20T12:00:00Z",
      timeSource: "observed",
    }),
  });
  const old = observation("old", "old-head");
  const current = observation("current", "new-head");
  const push: TimelineItem = {
    ...observation("push", "new-head"),
    event: repositoryEventSchema.parse({
      ...current.event,
      id: "push",
      kind: "published",
      summary: "Changes pushed",
    }),
  };
  const grouped = groupTimeline([old, push, current]);
  expect(grouped.map((item) => item.id)).toEqual(["push", "current"]);
  expect(grouped[1]).toMatchObject({
    kind: "repository-group",
    group: "base-update",
    events: [old.event, current.event],
  });
  const agent: TimelineItem = {
    kind: "turn",
    id: "agent",
    at: old.at,
    turn: turn("agent", old.at),
    index: 0,
  };
  expect(groupTimeline([old, agent, current])).toHaveLength(3);
  const changed = {
    ...current,
    id: "changed",
    event: { ...current.event, summary: "main is 3 commits ahead" },
  };
  expect(groupTimeline([old, changed, current])).toHaveLength(3);
});

test("review activity groups a decision with feedback without conflating other reviews or authors", () => {
  const entry = (
    id: string,
    kind: "feedback" | "review",
    actor = "reviewer",
  ): Extract<TimelineItem, { kind: "repository" }> => ({
    kind: "repository",
    id,
    at: "2026-09-20T12:00:00Z",
    event: repositoryEventSchema.parse({
      id,
      kind,
      actor,
      summary: kind === "review" ? "requested changes" : "left feedback",
      body: `Full ${id} text`,
      url: `https://github.com/team/repo/pull/4#${id}`,
      prUrl: "https://github.com/team/repo/pull/4",
      headSha: "reviewed-head",
      occurredAt: "2026-09-20T12:00:00Z",
      timeSource: "github",
    }),
  });
  const feedback = entry("thread", "feedback");
  const decision = entry("decision", "review");
  const grouped = groupTimeline([feedback, decision]);
  expect(grouped).toHaveLength(1);
  expect(grouped[0]).toMatchObject({
    kind: "repository-group",
    group: "review",
    events: [feedback.event, decision.event],
  });
  expect(
    groupTimeline([decision, entry("different-review", "review")]),
  ).toHaveLength(2);
  expect(
    groupTimeline([feedback, entry("teammate", "review", "teammate")]),
  ).toHaveLength(2);
  const later = entry("later", "review");
  later.event.occurredAt = "2026-09-20T13:00:00Z";
  expect(groupTimeline([feedback, later])).toHaveLength(2);
  const otherHead = entry("other-head", "review");
  otherHead.event.headSha = "different-head";
  expect(groupTimeline([feedback, otherHead])).toHaveLength(2);
});
test("legacy history extracts only known generated evidence and excludes operational noise", () => {
  const legacy = turn("legacy", "2026-09-10T12:10:00Z");
  legacy.prompt = `${autopilotPromptPrefix}\n\nPull request: https://github.com/binbandit/test-repo/pull/14\n\nEvent comment:1:abc: comment by Tony: Handle empty names.\n\nFeedback comment:1 (https://github.com/binbandit/test-repo/pull/14#issuecomment-1):\nHandle empty names.`;
  const events = [
    "Task summary updated.",
    "The agent is working on the task.",
    "Published the task changes. Waiting for PR checks and feedback.",
    "Pull request merged.",
  ].map((text, index) =>
    eventSchema.parse({
      seq: index + 1,
      taskId: "task",
      turnId: null,
      kind: "system",
      text,
      createdAt: `2026-09-10T12:${20 + index}:00Z`,
    }),
  );
  const timeline = taskTimeline([legacy], events);
  const rows = timeline.filter((item) => item.kind === "repository");
  expect(rows).toHaveLength(3);
  expect(rows[0].event).toMatchObject({
    actor: "Tony",
    body: "Handle empty names.",
    url: "https://github.com/binbandit/test-repo/pull/14#issuecomment-1",
    timeSource: "observed",
  });
  expect(rows.slice(1).every((item) => item.event.actor === null)).toBe(true);
  expect(
    taskTimeline(
      [{ ...legacy, prompt: `Explain this prompt:\n${legacy.prompt}` }],
      [],
    ).filter((item) => item.kind === "repository"),
  ).toHaveLength(0);
});

test("legacy publication is omitted only when a completed no-op reviewed an already published head", () => {
  const reviewed = turn("reviewed", "2026-09-10T12:10:00Z");
  reviewed.endedAt = "2026-09-10T12:12:00Z";
  reviewed.result = resultSchema.parse({
    exitCode: 0,
    sessionId: null,
    summary: "The existing pull request satisfies the request.",
    diff: "",
    changes: [],
    verification: null,
    baseCommit: "existing-head",
    headCommit: "existing-head",
  });
  const published = eventSchema.parse({
    seq: 1,
    taskId: "task",
    turnId: null,
    kind: "system",
    text: "Published changes",
    createdAt: "2026-09-10T12:00:00Z",
    repository: repositoryEventSchema.parse({
      id: "published:existing-head",
      kind: "published",
      summary: "Published changes",
      headSha: "existing-head",
      occurredAt: "2026-09-10T12:00:00Z",
      timeSource: "nerilo",
    }),
  });
  const legacy = eventSchema.parse({
    seq: 2,
    taskId: "task",
    turnId: null,
    kind: "system",
    text: "Published the task changes. Waiting for PR checks and feedback.",
    createdAt: "2026-09-10T12:13:00Z",
  });
  const rows = taskTimeline([reviewed], [published, legacy]);
  expect(rows.map((item) => item.id)).toEqual([
    "published:existing-head",
    "turn:reviewed",
  ]);
  const retainsLegacy = (turns = [reviewed], events = [published, legacy]) =>
    taskTimeline(turns, events).some((item) => item.id === "legacy:2");
  expect(retainsLegacy([reviewed], [legacy])).toBe(true);
  expect(
    retainsLegacy([
      { ...reviewed, result: { ...reviewed.result, diff: "file changes" } },
    ]),
  ).toBe(true);
  expect(
    retainsLegacy([
      { ...reviewed, result: { ...reviewed.result, headCommit: "new-head" } },
    ]),
  ).toBe(true);
  expect(
    retainsLegacy([
      {
        ...reviewed,
        result: {
          ...reviewed.result,
          baseCommit: "other-head",
          headCommit: "other-head",
        },
      },
    ]),
  ).toBe(true);
  expect(retainsLegacy([{ ...reviewed, result: null }])).toBe(true);
  expect(
    retainsLegacy([{ ...reviewed, endedAt: "2026-09-10T12:14:00Z" }]),
  ).toBe(true);
  expect(
    retainsLegacy(
      [reviewed],
      [
        {
          ...published,
          repository: {
            ...published.repository!,
            occurredAt: "2026-09-10T12:11:00Z",
          },
        },
        legacy,
      ],
    ),
  ).toBe(true);
  expect(
    retainsLegacy([
      reviewed,
      {
        ...reviewed,
        id: "later",
        startedAt: "2026-09-10T12:12:15Z",
        endedAt: "2026-09-10T12:12:30Z",
        result: null,
      },
    ]),
  ).toBe(true);
});

test("a later observed merge enriches the original merge row without duplicating it or showing post-merge freshness", () => {
  const prUrl = "https://github.com/binbandit/test-repo/pull/14";
  const at = "2026-09-10T12:00:00Z";
  const later = "2026-09-10T12:30:00Z";
  const legacy = eventSchema.parse({
    seq: 1,
    taskId: "task",
    turnId: null,
    kind: "system",
    text: "Checks and review requirements passed. Pull request squash-merged.",
    createdAt: at,
  });
  const observed = eventSchema.parse({
    seq: 2,
    taskId: "task",
    turnId: null,
    kind: "system",
    text: "Pull request merged",
    createdAt: later,
    repository: repositoryEventSchema.parse({
      id: `pr:${prUrl}:MERGED`,
      kind: "merged",
      summary: "Pull request merged",
      url: prUrl,
      prUrl,
      occurredAt: later,
      timeSource: "observed",
    }),
  });
  const ahead = eventSchema.parse({
    ...observed,
    seq: 3,
    repository: {
      ...observed.repository,
      id: "base:post-merge",
      kind: "base-update",
      summary: "main is 1 commit ahead",
    },
  });
  const timeline = taskTimeline([], [legacy, observed, ahead]);
  const merges = timeline.filter(
    (item) => item.kind === "repository" && item.event.kind === "merged",
  );
  expect(merges).toHaveLength(1);
  expect(merges[0]).toMatchObject({
    at,
    event: {
      occurredAt: at,
      timeSource: "nerilo",
      summary: "Pull request squash-merged",
      url: prUrl,
      prUrl,
    },
  });
  expect(
    timeline.some(
      (item) => item.kind === "repository" && item.event.kind === "base-update",
    ),
  ).toBe(false);
  const other = eventSchema.parse({
    ...observed,
    seq: 4,
    repository: {
      ...observed.repository,
      id: "another-pr-merge",
      prUrl: "https://github.com/binbandit/test-repo/pull/15",
      url: "https://github.com/binbandit/test-repo/pull/15",
    },
  });
  expect(
    taskTimeline([], [legacy, observed, other]).filter(
      (item) => item.kind === "repository" && item.event.kind === "merged",
    ),
  ).toHaveLength(3);
});

test("structured feedback replaces the matching legacy fingerprint while preserving actual comment revisions", () => {
  const legacy = turn("legacy", "2026-09-10T12:10:00Z");
  const prUrl = "https://github.com/binbandit/test-repo/pull/14";
  legacy.prompt = `${autopilotPromptPrefix}\n\nPull request: ${prUrl}\n\nEvent comment:1:abc: comment by Tony: Handle empty names.\n\nFeedback comment:1 (${prUrl}#issuecomment-1):\nHandle empty names.`;
  const observed = eventSchema.parse({
    seq: 1,
    taskId: "task",
    turnId: null,
    kind: "system",
    text: "left feedback",
    createdAt: "2026-09-10T12:30:00Z",
    repository: repositoryEventSchema.parse({
      id: "feedback:comment:1:abc",
      kind: "feedback",
      summary: "left feedback",
      actor: "Tony",
      body: "Handle empty names.",
      url: `${prUrl}#issuecomment-1`,
      prUrl,
      occurredAt: "2026-09-10T12:05:00Z",
      timeSource: "github",
    }),
  });
  const rows = taskTimeline([legacy], [observed]).filter(
    (item) => item.kind === "repository",
  );
  expect(rows).toHaveLength(1);
  expect(rows[0].event).toMatchObject({
    id: "feedback:comment:1:abc",
    actor: "Tony",
    timeSource: "github",
    occurredAt: "2026-09-10T12:05:00Z",
  });
  const edited = eventSchema.parse({
    ...observed,
    seq: 2,
    repository: {
      ...observed.repository,
      id: "feedback:comment:1:changed",
      body: "Handle empty and whitespace-only names.",
    },
  });
  expect(
    taskTimeline([legacy], [observed, edited]).filter(
      (item) => item.kind === "repository",
    ),
  ).toHaveLength(2);
});
