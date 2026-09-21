import { expect, test } from "bun:test";
import {
  matchesPullRequest,
  pullRequestWorkspaces,
} from "@/features/projects/project-pr-model";
import type { TaskStatus } from "@nerilo/protocol";

const pr = {
  url: "https://github.com/example/repo/pull/4",
  state: "open" as const,
};
const task = (id: string, status: TaskStatus, updatedAt: string) => ({
  id,
  status,
  updatedAt,
  projectId: "project",
  archived: false,
  pullRequests: [{ url: pr.url }],
});
const older = task("older-ready", "ready", "2026-09-20T12:00:00Z");
const completed = task("latest-completed", "complete", "2026-09-20T13:00:00Z");

test("merged and closed PRs open the latest workspace without resuming older unfinished copies", () => {
  for (const state of ["merged", "closed"] as const) {
    const selected = pullRequestWorkspaces([older, completed], "project", {
      ...pr,
      state,
    });
    expect(selected.continuing).toBeUndefined();
    expect(selected.preferred?.id).toBe(completed.id);
    expect(selected.latest?.id).toBe(completed.id);
    expect(selected.linked.map((task) => task.id)).toEqual([
      completed.id,
      older.id,
    ]);
  }
});

test("open PRs prefer an unfinished workspace while history still identifies the newest one", () => {
  const selected = pullRequestWorkspaces(
    [
      completed,
      older,
      { ...completed, id: "other-project", projectId: "other" },
    ],
    "project",
    pr,
  );
  expect(selected.continuing?.id).toBe(older.id);
  expect(selected.preferred?.id).toBe(older.id);
  expect(selected.latest?.id).toBe(completed.id);
  const archived = pullRequestWorkspaces(
    [{ ...older, archived: true }, completed],
    "project",
    pr,
  );
  expect(archived.continuing).toBeUndefined();
  expect(archived.preferred?.id).toBe(completed.id);
});

test("PR search matches copied author labels, bare logins, branches, titles, and numbers", () => {
  const pr = {
    title: "Normalize owners",
    number: 4,
    head: "codex/owners",
    author: "binbandit",
  };
  for (const query of [
    "@binbandit",
    "binbandit",
    " @BinBandit ",
    "#4",
    "normalize",
    "codex/owners",
  ])
    expect(matchesPullRequest(pr, query)).toBe(true);
  expect(matchesPullRequest(pr, "@sage-smudge")).toBe(false);
  expect(matchesPullRequest({ ...pr, author: null }, "@binbandit")).toBe(false);
});
