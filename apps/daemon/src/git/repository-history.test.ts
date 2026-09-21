import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  turnSchema,
  taskSchema,
  repositoryEventSchema,
} from "@nerilo/protocol";
import { Store } from "../platform/store";
import { decidePullRequest, type PullRequestFacts } from "./pr-observer";
import {
  captureObservation,
  repairOrigin,
  observationHistory,
} from "./repository-history";
import {
  refreshLinkedPullRequests,
  normalizePullRequest,
} from "./pull-requests";

const stores: Store[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
function observation() {
  const facts: PullRequestFacts = {
    url: "https://github.com/binbandit/test-repo/pull/14",
    repository: "binbandit/test-repo",
    number: 14,
    title: "Example",
    observedAt: "2026-09-10T12:00:00Z",
    state: "OPEN",
    draft: false,
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    prBaseSha: "b".repeat(40),
    headBranch: "feature",
    baseBranch: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    reviewDecision: null,
    behindBy: 0,
    canMerge: true,
    squashAllowed: true,
    rules: {
      known: true,
      strict: true,
      requiredChecks: [],
      approvingReviews: 0,
      conversationResolution: false,
      mergeQueue: false,
      squashAllowed: true,
      error: null,
    },
    checks: [
      {
        id: "check:1",
        name: "tests",
        appId: 1,
        state: "failing",
        headSha: "a".repeat(40),
        url: "https://github.com/binbandit/test-repo/actions/runs/1/job/1",
        details: "Expected fallback",
        updatedAt: "2026-09-10T11:59:00Z",
      },
      {
        id: "run:1:1",
        name: "CI",
        appId: null,
        state: "failing",
        headSha: "a".repeat(40),
        url: "https://github.com/binbandit/test-repo/actions/runs/1",
        details: "Expected fallback",
        updatedAt: "2026-09-10T11:59:00Z",
      },
    ],
    checksKnown: true,
    feedback: [
      {
        id: "comment:1",
        fingerprint: "comment:1:revision1",
        kind: "comment",
        author: "Tony",
        body: "Handle whitespace-only input",
        url: "https://github.com/binbandit/test-repo/pull/14#issuecomment-1",
        updatedAt: "2026-09-10T11:58:00Z",
        headSha: null,
        threadId: null,
        state: null,
        actionable: true,
      },
    ],
    unresolvedThreads: [],
    complete: true,
    errors: [],
  };
  return decidePullRequest(facts);
}
test("repository history persists exact evidence and deduplicates repeated observations and parent CI runs", () => {
  const store = new Store(":memory:");
  stores.push(store);
  const source = observation();
  captureObservation(store, "task", source);
  const seq = store.sequence();
  captureObservation(store, "task", {
    ...source,
    observedAt: "2026-09-10T12:01:00Z",
  });
  expect(store.sequence()).toBe(seq);
  const records = store.events("task").map((event) => event.repository!);
  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({
    actor: "Tony",
    body: "Handle whitespace-only input",
    url: source.feedback[0].url,
    occurredAt: source.feedback[0].updatedAt,
    timeSource: "github",
    headSha: null,
    baseSha: null,
    observedHeadSha: source.headSha,
    observedBaseSha: source.baseSha,
  });
  expect(records[1]).toMatchObject({
    kind: "ci",
    summary: "tests failed",
    status: "failing",
    headSha: source.headSha,
    baseSha: null,
  });
  source.checks[0].state = "passing";
  source.checks[1].state = "passing";
  captureObservation(store, "task", source);
  expect(
    store.events("task").filter((event) => event.repository?.kind === "ci"),
  ).toHaveLength(2);
  expect(repairOrigin(source)).toMatchObject({
    summary: "Address Tony's PR feedback",
    triggerEventIds: ["feedback:comment:1:revision1"],
  });
});

test("historical reviews use their reviewed commit and legacy observations hydrate without false event revisions", () => {
  const store = new Store(":memory:");
  stores.push(store);
  const source = observation();
  const reviewedHead = "c".repeat(40);
  source.feedback = [
    {
      ...source.feedback[0],
      kind: "review",
      state: "CHANGES_REQUESTED",
      headSha: reviewedHead,
    },
  ];
  const actual = observationHistory(source).find(
    (event) => event.kind === "review",
  )!;
  expect(actual.headSha).toBe(reviewedHead);
  expect(actual.baseSha).toBeNull();
  expect(actual.observedHeadSha).toBe(source.headSha);
  expect(actual.observedBaseSha).toBe(source.baseSha);

  const legacy = repositoryEventSchema.parse({
    ...actual,
    evidenceVersion: undefined,
    headSha: source.headSha,
    baseSha: source.baseSha,
    observedHeadSha: undefined,
    observedBaseSha: undefined,
    observedAt: undefined,
  });
  store.event({
    taskId: "task",
    turnId: null,
    kind: "system",
    text: legacy.summary,
    repository: legacy,
  });
  const hydrated = store.events("task")[0];
  expect(hydrated.repository).toMatchObject({
    headSha: null,
    baseSha: null,
    observedHeadSha: source.headSha,
    observedBaseSha: source.baseSha,
    observedAt: hydrated.createdAt,
  });
  const raw = JSON.parse(
    store.db
      .query<{ repository: string }, []>("SELECT repository FROM events")
      .get()!.repository,
  );
  expect(raw.headSha).toBe(source.headSha);
  const sequence = store.sequence();
  store.repositoryEvent("task", {
    ...actual,
    observedHeadSha: "d".repeat(40),
    observedBaseSha: "e".repeat(40),
  });
  expect(store.sequence()).toBe(sequence);
  expect(store.events("task")[0].repository).toMatchObject({
    evidenceVersion: 2,
    headSha: reviewedHead,
    baseSha: null,
    observedHeadSha: source.headSha,
    observedBaseSha: source.baseSha,
  });
  expect(store.events("task")[0].seq).toBe(hydrated.seq);
});

test("legacy CI retains its checked revision without claiming the later observed base", () => {
  const store = new Store(":memory:");
  stores.push(store);
  const source = observation();
  const ci = observationHistory(source).find((event) => event.kind === "ci")!;
  store.event({
    taskId: "task",
    turnId: null,
    kind: "system",
    text: ci.summary,
    repository: repositoryEventSchema.parse({
      ...ci,
      evidenceVersion: undefined,
      baseSha: "d".repeat(40),
      observedHeadSha: undefined,
      observedBaseSha: undefined,
      observedAt: undefined,
    }),
  });
  expect(store.events("task")[0].repository).toMatchObject({
    headSha: source.headSha,
    baseSha: null,
    observedBaseSha: "d".repeat(40),
  });
  const baseUpdate = observationHistory({ ...source, behindBy: 2 }).find(
    (event) => event.kind === "base-update",
  )!;
  expect(baseUpdate).toMatchObject({
    headSha: source.headSha,
    baseSha: source.baseSha,
  });
});

test("turn chronology is stable after importing and updating older turns", () => {
  const store = new Store(":memory:");
  stores.push(store);
  const make = (id: string, startedAt: string) =>
    turnSchema.parse({
      id,
      taskId: "task",
      inputId: id,
      prompt: id,
      status: "finished",
      container: "fake",
      cursor: 0,
      startedAt,
      endedAt: startedAt,
      result: null,
    });
  const late = make("late", "2026-09-10T12:30:00Z");
  const early = make("early", "2026-09-10T12:00:00Z");
  store.put("turn", late.id, late);
  store.put("turn", early.id, early);
  store.put("turn", early.id, { ...early, prompt: "An updated old prompt" });
  expect(store.all("turn").map((turn) => turn.id)).toEqual(["early", "late"]);
  expect(store.all("turn").at(-1)?.id).toBe("late");
});

test("legacy imported PR linkage is observed history without rewriting genuine creation events", () => {
  const store = new Store(":memory:");
  stores.push(store);
  const url = "https://github.com/binbandit/test-repo/pull/14";
  store.put(
    "task",
    "task",
    taskSchema.parse({
      id: "task",
      projectId: "project",
      title: "Imported contribution",
      provider: "codex",
      presetId: "programmer",
      model: "",
      status: "ready",
      sessionId: null,
      baseCommit: null,
      includeChanges: false,
      pending: [],
      activeTurnId: null,
      createdAt: "now",
      updatedAt: "now",
      archived: false,
      error: null,
      stopRequested: false,
      source: {
        url,
        repository: "binbandit/test-repo",
        number: 14,
        headCommit: "a".repeat(40),
        baseCommit: "b".repeat(40),
      },
    }),
  );
  for (const timeSource of ["observed", "nerilo"] as const)
    store.event({
      taskId: "task",
      turnId: null,
      kind: "system",
      text: "Pull request #14 opened",
      repository: repositoryEventSchema.parse({
        id: timeSource === "observed" ? `pr-linked:${url}` : `pr-opened:${url}`,
        kind: "pr-opened",
        summary: "Pull request #14 opened",
        prUrl: url,
        url,
        occurredAt: "2026-09-20T11:00:00Z",
        timeSource,
      }),
    });
  const events = store.events("task");
  expect(events[0].repository).toMatchObject({
    kind: "pr-linked",
    summary: "Observed existing pull request #14",
    timeSource: "observed",
  });
  expect(events[0].text).toBe("Observed existing pull request #14");
  expect(events[1].repository?.kind).toBe("pr-opened");
  expect(
    JSON.parse(
      store.db
        .query<{ repository: string }, []>(
          "SELECT repository FROM events ORDER BY seq LIMIT 1",
        )
        .get()!.repository,
    ).kind,
  ).toBe("pr-opened");
});

test("base freshness is captured only while the pull request is open", () => {
  const source = { ...observation(), behindBy: 1 };
  expect(
    observationHistory(source).some((event) => event.kind === "base-update"),
  ).toBe(true);
  for (const state of ["MERGED", "CLOSED"] as const)
    expect(
      observationHistory({ ...source, state }).some(
        (event) => event.kind === "base-update",
      ),
    ).toBe(false);
});

test("existing databases retain old events and deduplication survives reopening", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-history-test-"));
  const path = join(directory, "history.sqlite");
  try {
    const old = new Database(path);
    old.exec(
      "CREATE TABLE events(seq INTEGER PRIMARY KEY AUTOINCREMENT,taskId TEXT,turnId TEXT,kind TEXT NOT NULL,text TEXT NOT NULL,createdAt TEXT NOT NULL)",
    );
    old
      .query("INSERT INTO events(taskId,kind,text,createdAt) VALUES(?,?,?,?)")
      .run("task", "system", "Old event", "2026-09-10T11:00:00Z");
    old.close();
    const migrated = new Store(path);
    expect(migrated.events("task")[0]).toMatchObject({
      text: "Old event",
      repository: undefined,
    });
    captureObservation(migrated, "task", observation());
    const sequence = migrated.sequence();
    migrated.db.close();
    const reopened = new Store(path);
    try {
      captureObservation(reopened, "task", observation());
      expect(reopened.sequence()).toBe(sequence);
      expect(reopened.events("task")).toHaveLength(3);
    } finally {
      reopened.db.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normal linked PR refresh captures feedback without enabling Autopilot or double-polling it", async () => {
  const store = new Store(":memory:");
  stores.push(store);
  const source = observation();
  const pr = normalizePullRequest({
    url: source.url,
    number: 14,
    title: "Example",
    state: "OPEN",
    isDraft: false,
    reviewDecision: null,
    mergeable: "MERGEABLE",
    headRefName: "feature",
    baseRefName: "main",
    statusCheckRollup: [],
  });
  for (const id of ["manual", "autopilot", "also-manual"])
    store.put(
      "task",
      id,
      taskSchema.parse({
        id,
        projectId: "project",
        title: id,
        provider: "codex",
        presetId: "programmer",
        model: "",
        status: "ready",
        sessionId: null,
        baseCommit: null,
        includeChanges: false,
        pending: [],
        activeTurnId: null,
        createdAt: "2026-09-10T11:00:00Z",
        updatedAt: "2026-09-10T11:00:00Z",
        archived: false,
        error: null,
        stopRequested: false,
        pullRequests: [
          {
            ...pr,
            syncedAt: "2026-01-01T00:00:00Z",
            attemptedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
  let observations = 0;
  await refreshLinkedPullRequests(store, {
    read: async () => pr,
    observe: async () => {
      observations++;
      return source;
    },
    autopilotObserves: (id) => id === "autopilot",
  });
  expect(observations).toBe(1);
  expect(store.events("manual")).toHaveLength(2);
  expect(store.events("also-manual")).toHaveLength(2);
  expect(store.events("autopilot")).toHaveLength(0);
  expect(store.get("task", "manual")?.status).toBe("ready");
  expect(store.get("task", "manual")?.pending).toHaveLength(0);
});
