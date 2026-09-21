import { expect, test } from "bun:test";
import { pullRequestSchema, taskSchema } from "@nerilo/protocol";
import {
  pullRequestReadiness,
  taskCanCompleteMergedPR,
} from "@/features/review/pull-request-status";

const pr = pullRequestSchema.parse({
  url: "https://github.com/team/repo/pull/4",
  number: 4,
  title: "Priority queue",
  repository: "team/repo",
  state: "open",
  review: "changes_requested",
  checks: "passing",
  checkRuns: [],
  conflicts: true,
  head: "codex/priority",
  base: "main",
  syncedAt: "2026-09-20T12:00:00Z",
  error: null,
});

test("passing checks never conceal conflicts or requested changes", () => {
  const readiness = pullRequestReadiness(pr);
  expect(readiness.headline).toBe("Conflicts with main");
  expect(readiness.blockers).toEqual([
    "Conflicts with main",
    "Changes requested",
  ]);
  expect(readiness.tone).toBe("attention");
  expect(pullRequestReadiness({ ...pr, checks: "none" }).waiting).toContain(
    "No GitHub checks on this revision",
  );
});

test("stale status stays explicit and closed PRs do not retain former blockers", () => {
  expect(pullRequestReadiness({ ...pr, error: "Offline" }).headline).toBe(
    "GitHub status unavailable",
  );
  expect(pullRequestReadiness({ ...pr, state: "merged" })).toEqual({
    blockers: [],
    waiting: [],
    headline: "Merged",
    tone: "success",
  });
  const approved = pullRequestReadiness({
    ...pr,
    conflicts: false,
    review: "approved",
  });
  expect(approved.headline).toBe("Approved");
  expect(approved.tone).toBe("neutral");
});

test("checks from a previous revision are not presented as the pushed revision's result", () => {
  const readiness = pullRequestReadiness(
    {
      ...pr,
      conflicts: false,
      review: "approved",
      checks: "passing",
      headSha: "old-head",
    },
    "new-head",
  );
  expect(readiness.blockers).toEqual([]);
  expect(readiness.waiting).toEqual([
    "Waiting for GitHub status on the pushed revision",
  ]);
  expect(readiness.headline).toBe("Waiting for GitHub status");
  expect(readiness.tone).toBe("neutral");
});

test("merged completion is only offered for idle tasks without another open PR", () => {
  const task = taskSchema.parse({
    id: "task",
    projectId: "project",
    title: "Priority queue",
    presetId: "programmer",
    provider: "codex",
    model: "model",
    prompt: "Implement priorities",
    status: "ready",
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
    sessionId: null,
    baseCommit: null,
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    archived: false,
    error: null,
    stopRequested: false,
    pullRequests: [{ ...pr, state: "merged" }],
  });
  expect(taskCanCompleteMergedPR(task)).toBe(true);
  expect(
    taskCanCompleteMergedPR({
      ...task,
      pullRequests: [...task.pullRequests, pr],
    }),
  ).toBe(false);
  expect(taskCanCompleteMergedPR({ ...task, activeTurnId: "active" })).toBe(
    false,
  );
  expect(taskCanCompleteMergedPR({ ...task, status: "complete" })).toBe(false);
  expect(
    taskCanCompleteMergedPR({
      ...task,
      pending: [
        {
          id: "next",
          text: "More work",
          createdAt: task.createdAt,
          scheduledAt: null,
        },
      ],
    }),
  ).toBe(false);
});
