import { afterEach, expect, setSystemTime, test } from "bun:test";
import { pullRequestSchema, taskSchema } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { GithubAccountUnavailableError } from "./github-context";
import {
  normalizePullRequest,
  readPullRequest,
  refreshLinkedPullRequests,
} from "./pull-requests";

const raw = {
  url: "https://github.com/team/repository/pull/3",
  number: 3,
  title: "Support handoff",
  state: "OPEN",
  isDraft: false,
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  headRefName: "handoff",
  baseRefName: "main",
  statusCheckRollup: [],
};
const stores: Store[] = [];
afterEach(() => {
  setSystemTime();
  for (const store of stores.splice(0)) store.db.close();
});

function fixture() {
  setSystemTime(new Date("2026-09-20T12:00:00Z"));
  const store = new Store(":memory:");
  stores.push(store);
  const task = taskSchema.parse({
    id: "task",
    projectId: "project",
    title: "Support handoff",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "ready",
    sessionId: null,
    baseCommit: null,
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "2026-09-20T12:00:00Z",
    updatedAt: "2026-09-20T12:00:00Z",
    archived: false,
    error: null,
    stopRequested: false,
    pullRequests: [normalizePullRequest(raw)],
  });
  store.put("task", task.id, task);
  return { store, task };
}

test("failed refreshes preserve successful status age, pace retries, and recover", async () => {
  const { store, task } = fixture();
  const previous = task.pullRequests[0];
  let attempts = 0;
  const failure = {
    read: async () => {
      attempts++;
      throw new Error("GitHub could not be reached");
    },
  };
  setSystemTime(new Date("2026-09-20T23:00:00Z"));
  await refreshLinkedPullRequests(store, failure);
  expect(store.get("task", task.id)?.pullRequests[0]).toEqual({
    ...previous,
    attemptedAt: "2026-09-20T23:00:00.000Z",
    error: "GitHub could not be reached",
  });

  setSystemTime(new Date("2026-09-20T23:00:59Z"));
  await refreshLinkedPullRequests(store, failure);
  expect(attempts).toBe(1);
  setSystemTime(new Date("2026-09-20T23:01:00Z"));
  await refreshLinkedPullRequests(store, failure);
  expect(attempts).toBe(2);
  expect(store.get("task", task.id)?.pullRequests[0]).toMatchObject({
    syncedAt: previous.syncedAt,
    attemptedAt: "2026-09-20T23:01:00.000Z",
  });

  setSystemTime(new Date("2026-09-20T23:02:00Z"));
  await refreshLinkedPullRequests(store, {
    read: async () => normalizePullRequest({ ...raw, state: "MERGED" }),
  });
  expect(store.get("task", task.id)?.pullRequests[0]).toMatchObject({
    state: "merged",
    syncedAt: "2026-09-20T23:02:00.000Z",
    attemptedAt: "2026-09-20T23:02:00.000Z",
    error: null,
  });
});

test("legacy saved errors retain attempt timing without inventing a successful update", async () => {
  const { store, task } = fixture();
  const legacy = {
    ...task.pullRequests[0],
    attemptedAt: undefined,
    syncedAt: "2026-09-20T22:59:30.000Z",
    error: "Old refresh failed",
  };
  const stored = JSON.stringify({ ...task, pullRequests: [legacy] });
  store.db
    .query("UPDATE records SET data=? WHERE kind='task' AND id=?")
    .run(stored, task.id);
  const migrated = store.get("task", task.id)!.pullRequests[0];
  expect(migrated).toMatchObject({
    syncedAt: null,
    attemptedAt: legacy.syncedAt,
    error: legacy.error,
  });
  expect(pullRequestSchema.parse(migrated)).toEqual(migrated);
  expect(
    store.db
      .query<{ data: string }, [string]>(
        "SELECT data FROM records WHERE kind='task' AND id=?",
      )
      .get(task.id)?.data,
  ).toBe(stored);
  expect(pullRequestSchema.parse({ ...legacy, error: null })).toMatchObject({
    syncedAt: legacy.syncedAt,
    error: null,
  });

  let attempts = 0;
  setSystemTime(new Date("2026-09-20T23:00:00Z"));
  await refreshLinkedPullRequests(store, {
    read: async () => {
      attempts++;
      return normalizePullRequest(raw);
    },
  });
  expect(attempts).toBe(0);
  setSystemTime(new Date("2026-09-20T23:00:30Z"));
  await refreshLinkedPullRequests(store, {
    read: async () => normalizePullRequest(raw),
  });
  expect(store.get("task", task.id)?.pullRequests[0]).toMatchObject({
    syncedAt: "2026-09-20T23:00:30.000Z",
    attemptedAt: "2026-09-20T23:00:30.000Z",
    error: null,
  });
});

test("PR read errors distinguish recoverable failures without exposing raw diagnostics", async () => {
  const failures = [
    [new Error("Command timed out after 15000 ms. private-token"), "too long"],
    [
      new Error("dial tcp: no such host private-token"),
      "Could not reach GitHub",
    ],
    [
      new Error("HTTP 403: API rate limit exceeded private-token"),
      "limiting requests",
    ],
    [
      new Error("HTTP 401: Bad credentials private-token"),
      "selected GitHub account",
    ],
    [
      Object.assign(new Error("private-token"), { code: "ENOENT" }),
      "Install GitHub CLI",
    ],
    [new Error("private-token"), "could not be refreshed"],
  ] as const;
  for (const [cause, expected] of failures) {
    let caught: unknown;
    try {
      await readPullRequest(raw.url, {
        checked: async () => {
          throw cause;
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (!(caught instanceof Error)) throw new Error("Expected read failure");
    expect(caught.message).toContain(expected);
    expect(caught.message).not.toContain("private-token");
    expect(caught.cause).toBe(cause);
  }
  for (const output of ["not JSON private-token", "{}"])
    await expect(
      readPullRequest(raw.url, { checked: async () => output }),
    ).rejects.toThrow("unexpected PR status response");

  const credentialError = new GithubAccountUnavailableError("reviewer");
  await expect(
    readPullRequest(raw.url, {
      checked: async () => {
        throw credentialError;
      },
    }),
  ).rejects.toBe(credentialError);
});
