import { test, expect } from "bun:test";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskSchema, turnSchema, projectSchema } from "@nerilo/protocol";
import { Store } from "./store";
import { Engine } from "./engine";
import { checked } from "./config";
import { tickAutonomy } from "./autonomy";
import { normalizePullRequest } from "./pull-requests";
import { decidePullRequest } from "./pr-observer";
import { withTaskLock } from "./task-locks";

const stored = z
  .object({
    publication: z
      .object({ head: z.string(), stage: z.string() })
      .passthrough()
      .nullable()
      .optional(),
    processedTurnId: z.string().nullable(),
    publishedHead: z.string().nullable(),
    prUrl: z.string().nullable(),
    failures: z.number(),
    retryAfter: z.string().nullable(),
    awaitingReply: z.array(z.string()),
    ignoredEventIds: z.array(z.string()),
    status: z.string(),
    detail: z.string(),
    workingPath: z.string().nullable(),
  })
  .passthrough();

async function fixture(snapshot = false) {
  const root = await mkdtemp(join(tmpdir(), "nerilo-autonomy-recovery-"));
  const source = join(root, "source");
  await checked(["git", "init", "-b", "main", source]);
  const git = ["git", "-C", source];
  await checked([...git, "config", "user.name", "Fixture"]);
  await checked([
    ...git,
    "config",
    "user.email",
    snapshot ? "snapshot@nerilo.local" : "fixture@example.test",
  ]);
  await Bun.write(join(source, "README.md"), "Original\n");
  await checked([...git, "add", "."]);
  await checked([
    ...git,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    snapshot ? "Local working snapshot" : "Initial",
  ]);
  const base = await checked([...git, "rev-parse", "HEAD"]);
  await Bun.write(join(source, "README.md"), "Improved\n");
  const diff = await checked([...git, "diff", "HEAD"]);
  await checked([...git, "restore", "README.md"]);
  const store = new Store(":memory:");
  const taskId = crypto.randomUUID();
  const task = taskSchema.parse({
    id: taskId,
    projectId: "project",
    title: "Improve source",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "ready",
    sessionId: null,
    baseCommit: base,
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "now",
    updatedAt: "now",
    archived: false,
    error: null,
    stopRequested: false,
  });
  const turn = turnSchema.parse({
    id: "turn",
    taskId,
    inputId: "input",
    prompt: "Improve source",
    status: "finished",
    container: "unused",
    cursor: 0,
    startedAt: "now",
    endedAt: "now",
    result: {
      exitCode: 0,
      sessionId: null,
      summary: "Improved source.",
      diff,
      changes: [],
      verification: null,
      baseCommit: base,
      headCommit: base,
    },
  });
  store.put(
    "project",
    "project",
    projectSchema.parse({
      id: "project",
      path: source,
      name: "Fixture",
      branch: "main",
      createdAt: "now",
    }),
  );
  store.put("task", taskId, task);
  store.put("turn", turn.id, turn);
  store.db.exec(
    "CREATE TABLE task_autonomy(taskId TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
  const original = {
    taskId,
    mode: "pr",
    status: "waiting",
    repository: "example/project",
    base: "main",
    branch: `nerilo/${taskId.slice(0, 8)}`,
    prUrl: null,
    detail: "Waiting",
    repairTurns: 0,
    updatedAt: "now",
    workingPath: null,
    publishedHead: null,
    processedTurnId: null,
    cursor: null,
    ignoredEventIds: [],
    awaitingReply: [],
    rebaseTarget: null,
    mergeAfter: null,
    lastDecision: "",
    failures: 0,
    retryAfter: null,
  };
  store.db
    .query("INSERT INTO task_autonomy VALUES(?,?)")
    .run(taskId, JSON.stringify(original));
  const read = () =>
    stored.parse(
      JSON.parse(
        store.db
          .query<{ data: string }, [string]>(
            "SELECT data FROM task_autonomy WHERE taskId=?",
          )
          .get(taskId)!.data,
      ),
    );
  const patch = (value: Record<string, unknown>) =>
    store.db
      .query("UPDATE task_autonomy SET data=? WHERE taskId=?")
      .run(JSON.stringify({ ...read(), ...value }), taskId);
  const engine = new Engine(store, true);
  const counters = {
    exports: 0,
    pushes: 0,
    creates: 0,
    replies: 0,
    merges: 0,
    remoteReads: 0,
    drafts: 0,
  };
  engine.checkout = async () => {
    const path = join(root, `export-${++counters.exports}`);
    await checked(["git", "clone", "--", source, path]);
    await checked(["git", "-C", path, "apply", "-"], { input: `${diff}\n` });
    return { path, turnId: turn.id, createdAt: "now" };
  };
  const faults = {
    pushAccepted: false,
    createBefore: false,
    createAccepted: false,
    replyAccepted: false,
    replyBefore: false,
    mergeAccepted: false,
  };
  let head: string | null = null;
  let observedHead: string | null = null;
  let exists = false;
  let merged = false;
  const comments: Array<{ node_id: string; body: string }> = [];
  const url = "https://github.com/example/project/pull/1";
  const io: NonNullable<Parameters<typeof tickAutonomy>[2]> = {
    remoteResult: async () => {
      counters.remoteReads++;
      return {
        code: head ? 0 : 1,
        stdout: head ?? "",
        stderr: head ? "" : "HTTP 404",
      };
    },
    remote: async (args) => {
      if (args.includes("push")) {
        counters.pushes++;
        head = args.at(-1)!.split(":")[0];
        if (faults.pushAccepted) {
          faults.pushAccepted = false;
          throw new Error("Push response lost");
        }
        return "pushed";
      }
      if (args[1] === "pr" && args[2] === "list") return exists ? url : "";
      if (args[1] === "pr" && args[2] === "create") {
        counters.creates++;
        if (faults.createBefore) {
          faults.createBefore = false;
          throw new Error("PR creation unavailable");
        }
        exists = true;
        if (faults.createAccepted) {
          faults.createAccepted = false;
          throw new Error("PR response lost");
        }
        return url;
      }
      if (args.includes("--slurp")) return JSON.stringify([comments]);
      if (args.some((arg) => arg.endsWith("/comments"))) {
        counters.replies++;
        if (faults.replyBefore) {
          faults.replyBefore = false;
          throw new Error("Reply unavailable");
        }
        const comment = {
          node_id: `comment-${counters.replies}`,
          body: args.find((arg) => arg.startsWith("body="))!.slice(5),
        };
        comments.push(comment);
        if (faults.replyAccepted) {
          faults.replyAccepted = false;
          throw new Error("Reply response lost");
        }
        return JSON.stringify(comment);
      }
      if (args.some((arg) => arg.endsWith("/merge"))) {
        counters.merges++;
        merged = true;
        if (faults.mergeAccepted) {
          faults.mergeAccepted = false;
          throw new Error("Merge response lost");
        }
        return JSON.stringify({ merged: true, message: "Merged" });
      }
      throw new Error(`Unexpected external operation: ${args.join(" ")}`);
    },
    draft: async () => {
      counters.drafts++;
      return {
        branch: original.branch,
        commitTitle: task.title,
        prTitle: task.title,
        prBody: turn.result!.summary,
      };
    },
    readPR: async () =>
      normalizePullRequest({
        url,
        number: 1,
        title: task.title,
        state: merged ? "MERGED" : "OPEN",
        isDraft: false,
        reviewDecision: "",
        mergeable: "MERGEABLE",
        headRefName: original.branch,
        baseRefName: "main",
        statusCheckRollup: [],
      }),
    observe: async () =>
      decidePullRequest({
        url,
        repository: original.repository,
        number: 1,
        title: task.title,
        observedAt: new Date().toISOString(),
        state: merged ? "MERGED" : "OPEN",
        draft: false,
        headSha: observedHead ?? head!,
        baseSha: base,
        prBaseSha: base,
        headBranch: original.branch,
        baseBranch: "main",
        mergeable: "MERGEABLE",
        mergeStateStatus: "CLEAN",
        reviewDecision: null,
        behindBy: 0,
        canMerge: true,
        squashAllowed: true,
        rules: {
          known: true,
          strict: false,
          requiredChecks: [],
          approvingReviews: 0,
          conversationResolution: false,
          mergeQueue: false,
          squashAllowed: true,
          error: null,
        },
        checks: [],
        checksKnown: true,
        feedback: [],
        unresolvedThreads: [],
        complete: true,
        errors: [],
      }),
  };
  return {
    store,
    taskId,
    read,
    patch,
    faults,
    counters,
    comments,
    setHead: (value: string) => {
      head = value;
    },
    setObservedHead: (value: string | null) => {
      observedHead = value;
    },
    hidePR: () => {
      exists = false;
    },
    tick: async () => {
      patch({ retryAfter: null });
      await tickAutonomy(store, engine, io);
    },
    cleanup: async () => {
      store.db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("Autopilot blocks failed local verification before exporting or publishing", async () => {
  const f = await fixture();
  try {
    const turn = f.store.get("turn", "turn")!;
    f.store.put("turn", turn.id, {
      ...turn,
      result: {
        ...turn.result!,
        verification: { command: "test", exitCode: 7, output: "Failed" },
      },
    });
    await f.tick();
    expect(f.counters.exports).toBe(0);
    expect(f.counters.pushes).toBe(0);
    expect(f.counters.merges).toBe(0);
    expect(f.read().status).toBe("blocked");
    expect(f.read().detail).toContain("verification");
  } finally {
    await f.cleanup();
  }
});

test("ordinary workspace lock contention does not consume Autopilot retries", async () => {
  const f = await fixture();
  try {
    await withTaskLock(f.taskId, async () => {
      for (let i = 0; i < 3; i++) await f.tick();
    });
    expect(f.read().failures).toBe(0);
    expect(f.counters.exports).toBe(0);
    await f.tick();
    expect(f.counters.pushes).toBe(1);
  } finally {
    await f.cleanup();
  }
});

test("Autopilot resumes uncertain push and failed PR creation without recreating the commit", async () => {
  const f = await fixture();
  try {
    f.faults.pushAccepted = true;
    await f.tick();
    const prepared = f.read().publication!;
    expect(prepared.stage).toBe("prepared");
    expect(f.read().processedTurnId).toBeNull();
    f.faults.createBefore = true;
    await f.tick();
    expect(f.read().publication?.stage).toBe("pushed");
    expect(f.read().failures).toBe(2);
    await f.tick();
    expect(f.read().processedTurnId).toBe("turn");
    expect(f.read().publication).toBeNull();
    expect(f.read().publishedHead).toBe(prepared.head);
    expect(f.read().failures).toBe(0);
    expect(f.read().retryAfter).toBeNull();
    expect(f.counters.exports).toBe(1);
    expect(f.counters.pushes).toBe(1);
    await f.tick();
    expect(f.counters.pushes).toBe(1);
    expect(f.counters.creates).toBe(2);
  } finally {
    await f.cleanup();
  }
});

test("uncertain PR creation and feedback replies are read back instead of duplicated", async () => {
  const f = await fixture();
  try {
    f.patch({ awaitingReply: ["review-1"] });
    f.faults.createAccepted = true;
    await f.tick();
    f.faults.replyAccepted = true;
    await f.tick();
    expect(f.comments).toHaveLength(1);
    expect(f.read().processedTurnId).toBeNull();
    await f.tick();
    expect(f.counters.creates).toBe(1);
    expect(f.counters.replies).toBe(1);
    expect(f.read().awaitingReply).toEqual([]);
    expect(f.read().ignoredEventIds).toEqual(["comment-1"]);
    expect(f.read().processedTurnId).toBe("turn");
    expect(f.read().failures).toBe(0);
  } finally {
    await f.cleanup();
  }
});

test("legacy post-push records resume missing PR and reply work", async () => {
  const f = await fixture();
  try {
    await f.tick();
    f.hidePR();
    f.patch({
      prUrl: null,
      awaitingReply: ["review-legacy"],
      publication: null,
    });
    f.faults.replyBefore = true;
    await f.tick();
    expect(f.read().publication?.stage).toBe("pushed");
    await f.tick();
    expect(f.read().publication).toBeNull();
    expect(f.read().awaitingReply).toEqual([]);
    expect(f.counters.pushes).toBe(1);
    expect(f.counters.exports).toBe(1);
    expect(f.comments).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});

test("synthetic snapshot ancestry and externally changed branches block publication", async () => {
  const snapshot = await fixture(true);
  try {
    await snapshot.tick();
    expect(snapshot.read().detail).toContain("local working snapshot");
    expect(snapshot.counters.remoteReads).toBe(0);
    expect(snapshot.counters.pushes).toBe(0);
    expect(snapshot.counters.drafts).toBe(0);
  } finally {
    await snapshot.cleanup();
  }
  const f = await fixture();
  try {
    f.faults.pushAccepted = true;
    await f.tick();
    f.setHead("f".repeat(40));
    await f.tick();
    expect(f.read().detail).toContain("outside this task");
    expect(f.counters.pushes).toBe(1);
    expect(f.read().publication?.stage).toBe("prepared");
  } finally {
    await f.cleanup();
  }
});

test("lagging PR observations wait for refresh while foreign remote heads block", async () => {
  const f = await fixture();
  try {
    f.setObservedHead("a".repeat(40));
    await f.tick();
    expect(f.read().status).toBe("reviewing");
    expect(f.read().detail).toContain("Waiting for GitHub to refresh");
    expect(f.read().failures).toBe(0);
    expect(f.read().retryAfter).toBeNull();
    expect(f.store.get("task", f.taskId)?.pending).toHaveLength(0);
    f.patch({ mode: "merge", mergeAfter: null });
    await f.tick();
    expect(f.counters.merges).toBe(0);
    expect(f.read().failures).toBe(0);
    f.setHead("f".repeat(40));
    await f.tick();
    expect(f.read().status).toBe("blocked");
    expect(f.read().detail).toContain("outside this task");
    expect(f.read().failures).toBe(1);
    expect(f.counters.merges).toBe(0);
  } finally {
    await f.cleanup();
  }
});

test("an uncertain successful merge reconciles the task without another merge request", async () => {
  const f = await fixture();
  try {
    await f.tick();
    f.patch({ mode: "merge", mergeAfter: null });
    f.faults.mergeAccepted = true;
    await f.tick();
    expect(f.read().failures).toBe(1);
    await f.tick();
    expect(f.read().status).toBe("merged");
    expect(f.store.get("task", f.taskId)?.status).toBe("complete");
    expect(f.counters.merges).toBe(1);
    expect(f.read().failures).toBe(0);
  } finally {
    await f.cleanup();
  }
});
