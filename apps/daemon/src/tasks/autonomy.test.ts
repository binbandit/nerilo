import { test, expect, spyOn } from "bun:test";
import { z } from "zod";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { taskSchema, turnSchema, projectSchema } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { Engine } from "./engine";
import { checked } from "../platform/config";
import { configureAutonomy, tickAutonomy } from "./autonomy";
import { normalizePullRequest } from "../git/pull-requests";
import { decidePullRequest } from "../git/pr-observer";
import { withTaskLock } from "./task-locks";
import { createApi } from "../http/api";
import { githubCommandEnvironment } from "../git/github-context";

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
  engine.checkout = async (_task, _project, turnId) => {
    const result = store.get("turn", turnId)!.result!;
    const path = join(root, `export-${++counters.exports}`);
    await checked(["git", "clone", "--", source, path]);
    await checked([
      "git",
      "-C",
      path,
      "checkout",
      "--detach",
      result.baseCommit,
    ]);
    if (result.diff)
      await checked(["git", "-C", path, "apply", "--index", "-"], {
        input: `${result.diff}\n`,
      });
    await checked(["git", "-C", path, "reset", "--soft", result.headCommit]);
    await checked(["git", "-C", path, "reset", "--mixed", result.headCommit]);
    return { path, turnId, createdAt: "now" };
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
    source,
    base,
    io,
    store,
    engine,
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

test("background Autopilot uses the task GitHub override when observing a PR", async () => {
  const f = await fixture();
  try {
    f.store.put("project", "project", {
      ...f.store.get("project", "project")!,
      githubAccount: { hostname: "github.com", login: "work" },
    });
    f.store.put("task", f.taskId, {
      ...f.store.get("task", f.taskId)!,
      githubAccount: { hostname: "github.com", login: "personal" },
    });
    f.patch({
      prUrl: "https://github.com/example/project/pull/1",
      processedTurnId: "turn",
    });
    let identity: string | undefined;
    await tickAutonomy(f.store, f.engine, {
      observe: async () => {
        identity = (
          await githubCommandEnvironment(
            ["gh", "api", "user"],
            async (args) => ({ code: 0, stdout: args.at(-1)!, stderr: "" }),
          )
        )?.GH_TOKEN;
        throw new Error("Stop fixture after observing identity");
      },
    });
    expect(identity).toBe("personal");
  } finally {
    await f.cleanup();
  }
});

test("explicit adoption maintains the original PR branch without creating a duplicate", async () => {
  const f = await fixture();
  try {
    const task = f.store.get("task", f.taskId)!;
    const pr = normalizePullRequest({
      url: "https://github.com/example/project/pull/42",
      number: 42,
      title: "Existing contribution",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "CHANGES_REQUESTED",
      mergeable: "MERGEABLE",
      headRefName: "feature/manual",
      baseRefName: "main",
      statusCheckRollup: [],
    });
    f.store.put("project", "project", {
      ...f.store.get("project", "project")!,
      repository: "example/project",
    });
    f.store.put("task", task.id, { ...task, pullRequests: [pr] });
    f.store.db.query("DELETE FROM task_autonomy WHERE taskId=?").run(task.id);
    const remote: typeof checked = async (args, options) => {
      if (args.some((arg) => arg.endsWith("git/ref/heads/main"))) return f.base;
      if (args.some((arg) => arg.endsWith("pulls/42")))
        return JSON.stringify({
          state: "open",
          head: {
            ref: "feature/manual",
            sha: f.base,
            repo: { full_name: "example/project" },
          },
          base: { ref: "main", repo: { full_name: "example/project" } },
        });
      if (args.includes("fetch"))
        return checked(
          args.map((arg) =>
            arg === "https://github.com/example/project.git" ? f.source : arg,
          ),
          options,
        );
      return f.io.remote!(args, options);
    };
    const state = await configureAutonomy(
      f.store,
      task.id,
      { mode: "pr", adoptPullRequest: pr.url },
      { ...f.io, remote },
    );
    expect(state?.prUrl).toBe(pr.url);
    expect(state?.branch).toBe(pr.head);
    expect(f.read().publishedHead).toBe(f.base);
    f.setHead(f.base);
    await tickAutonomy(f.store, f.engine, {
      ...f.io,
      remote,
      readPR: async () => pr,
    });
    expect(f.counters.pushes).toBe(1);
    expect(f.counters.creates).toBe(0);
    expect(f.read().prUrl).toBe(pr.url);
    expect(f.read().status).toBe("reviewing");
    const history = f.store
      .events(task.id)
      .flatMap((event) => event.repository ?? []);
    expect(history.filter((event) => event.kind === "pr-opened")).toHaveLength(
      0,
    );
    expect(history.find((event) => event.kind === "pr-linked")?.summary).toBe(
      "Autopilot continued existing pull request #42",
    );
    const workingPath = f.read().workingPath;
    if (workingPath) await rm(workingPath, { recursive: true, force: true });
  } finally {
    await f.cleanup();
  }
});

test("Autopilot publishes an adopted ancestry-only merge without flattening its parents", async () => {
  const f = await fixture();
  try {
    const git = ["git", "-C", f.source];
    await checked([...git, "switch", "-c", "base-update"]);
    await Bun.write(join(f.source, "README.md"), "Teammate update\n");
    await checked([...git, "add", "."]);
    await checked([...git, "commit", "-m", "Teammate update"]);
    const targetBase = await checked([...git, "rev-parse", "HEAD"]);
    await checked([...git, "switch", "-c", "feature/manual", f.base]);
    await Bun.write(join(f.source, "README.md"), "Teammate update\n");
    await checked([...git, "add", "."]);
    await checked([
      ...git,
      "commit",
      "-m",
      "Equivalent repair without base ancestry",
    ]);
    const previousHead = await checked([...git, "rev-parse", "HEAD"]);
    await checked([...git, "merge", "--no-ff", "--no-edit", "base-update"]);
    const mergedHead = await checked([...git, "rev-parse", "HEAD"]);
    expect(await checked([...git, "diff", previousHead, mergedHead])).toBe("");
    const turn = f.store.get("turn", "turn")!;
    f.store.put("turn", turn.id, {
      ...turn,
      result: {
        ...turn.result!,
        baseCommit: previousHead,
        headCommit: mergedHead,
        diff: "",
      },
    });
    f.patch({
      publishedHead: previousHead,
      workingPath: f.source,
      prUrl: "https://github.com/example/project/pull/1",
    });
    f.setHead(previousHead);
    f.engine.checkout = async () => {
      const path = join(f.source, "..", "merged-export");
      await checked(["git", "clone", f.source, path]);
      return { path, turnId: turn.id, createdAt: "now" };
    };
    await f.tick();
    expect(f.read().publishedHead).toBe(mergedHead);
    expect(f.counters.pushes).toBe(1);
    expect(f.counters.creates).toBe(0);
    expect(f.counters.drafts).toBe(0);
    const parents = await checked([
      ...git,
      "show",
      "-s",
      "--format=%P",
      f.read().publishedHead!,
    ]);
    expect(parents.split(" ")).toEqual([previousHead, targetBase]);
  } finally {
    await f.cleanup();
  }
});

test("reviewing an unchanged existing PR emits neither publication nor creation history", async () => {
  const f = await fixture();
  try {
    const turn = f.store.get("turn", "turn")!;
    f.store.put("turn", turn.id, {
      ...turn,
      result: {
        ...turn.result!,
        diff: "",
        summary: "The requested behavior already works.",
      },
    });
    f.patch({
      prUrl: "https://github.com/example/project/pull/1",
      publishedHead: f.base,
      workingPath: f.source,
      awaitingReply: ["feedback:1"],
    });
    f.setHead(f.base);
    await f.tick();
    expect(f.read().processedTurnId).toBe(turn.id);
    expect(f.counters.pushes).toBe(0);
    expect(f.counters.creates).toBe(0);
    const events = f.store.events(f.taskId);
    expect(
      events.some((event) =>
        ["published", "pr-opened"].includes(event.repository?.kind ?? ""),
      ),
    ).toBe(false);
    expect(
      events.some((event) =>
        event.text.startsWith("Published the task changes."),
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) =>
          event.text ===
          "Reviewed the existing PR head. No new commit or push was needed.",
      ),
    ).toBe(true);
    expect(f.comments[0].body).toContain("no new commit was needed");
    expect(f.comments[0].body).not.toContain("Updated in");
  } finally {
    await f.cleanup();
  }
});

test("adoption refuses a newer teammate head and merge configuration checks policy before saving", async () => {
  const f = await fixture();
  try {
    const task = f.store.get("task", f.taskId)!;
    const pr = normalizePullRequest({
      url: "https://github.com/example/project/pull/42",
      number: 42,
      title: "Existing contribution",
      state: "OPEN",
      isDraft: false,
      reviewDecision: "",
      mergeable: "MERGEABLE",
      headRefName: "feature/manual",
      baseRefName: "main",
      statusCheckRollup: [],
    });
    f.store.put("project", "project", {
      ...f.store.get("project", "project")!,
      repository: "example/project",
    });
    f.store.put("task", task.id, { ...task, pullRequests: [pr] });
    f.store.db.query("DELETE FROM task_autonomy WHERE taskId=?").run(task.id);
    const remote: typeof checked = async (args) =>
      args.some((arg) => arg.endsWith("pulls/42"))
        ? JSON.stringify({
            state: "open",
            head: {
              ref: "feature/manual",
              sha: "a".repeat(40),
              repo: { full_name: "example/project" },
            },
            base: { ref: "main", repo: { full_name: "example/project" } },
          })
        : f.base;
    await expect(
      configureAutonomy(
        f.store,
        task.id,
        { mode: "pr", adoptPullRequest: pr.url },
        { remote },
      ),
    ).rejects.toThrow("changed outside this task");
    await expect(
      configureAutonomy(
        f.store,
        task.id,
        { mode: "merge", adoptPullRequest: pr.url },
        {
          remote,
          mergeCapability: async () => {
            throw new Error("Private plan does not expose branch requirements");
          },
        },
      ),
    ).rejects.toThrow("Private plan");
    expect(
      f.store.db
        .query("SELECT taskId FROM task_autonomy WHERE taskId=?")
        .get(task.id),
    ).toBeNull();
    expect(f.counters.pushes).toBe(0);
  } finally {
    await f.cleanup();
  }
});

test("Autopilot does not create a second PR for manually published work", async () => {
  const f = await fixture();
  try {
    const task = f.store.get("task", f.taskId)!;
    f.store.put("task", task.id, {
      ...task,
      pullRequests: [
        normalizePullRequest({
          url: "https://github.com/example/project/pull/42",
          number: 42,
          title: "Already published",
          state: "OPEN",
          isDraft: false,
          reviewDecision: "CHANGES_REQUESTED",
          mergeable: "MERGEABLE",
          headRefName: "feature/manual",
          baseRefName: "main",
          statusCheckRollup: [],
        }),
      ],
    });
    await f.tick();
    expect(f.counters.exports).toBe(0);
    expect(f.counters.pushes).toBe(0);
    expect(f.counters.creates).toBe(0);
    expect(f.read().detail).toContain("already has a pull request");

    f.store.db.query("DELETE FROM task_autonomy WHERE taskId=?").run(task.id);
    await expect(
      configureAutonomy(f.store, task.id, { mode: "pr" }),
    ).rejects.toThrow("already has a pull request");
    expect(
      f.store.db
        .query("SELECT taskId FROM task_autonomy WHERE taskId=?")
        .get(task.id),
    ).toBeNull();
  } finally {
    await f.cleanup();
  }
});

async function finishUserFollowUp(
  f: Awaited<ReturnType<typeof fixture>>,
  commit = false,
) {
  const schedule = spyOn(f.engine, "tick").mockResolvedValue();
  try {
    const api = createApi(f.store, f.engine, "fixture");
    const post = (action: string, body: unknown) =>
      api(
        new Request(`http://localhost/tasks/${f.taskId}/${action}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer fixture",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        }),
      );
    expect(
      (
        await post("execution", {
          provider: "claude",
          model: "sonnet",
          effort: "medium",
        })
      ).status,
    ).toBe(200);
    expect(
      (await post("follow-up", { text: "Add a worked example" })).status,
    ).toBe(200);
    const task = f.store.get("task", f.taskId)!;
    const original = f.store.get("turn", "turn")!;
    const git = ["git", "-C", f.source];
    await Bun.write(
      join(f.source, "README.md"),
      "Improved\n\nWorked example\n",
    );
    if (commit) {
      await checked([...git, "add", "."]);
      await checked([...git, "commit", "-m", "Add worked example"]);
    }
    const result = {
      ...original.result!,
      diff: await checked([...git, "diff", f.base]),
      headCommit: await checked([...git, "rev-parse", "HEAD"]),
      summary: "Preserved the first contribution and added a worked example.",
    };
    await checked([...git, "restore", "README.md"]);
    f.store.put("turn", "follow-up", {
      ...original,
      id: "follow-up",
      inputId: task.pending[0].id,
      prompt: task.pending[0].text,
      execution: {
        provider: task.provider,
        model: task.model,
        effort: "medium",
      },
      result,
    });
    f.store.put("task", task.id, { ...task, status: "ready", pending: [] });
    return result;
  } finally {
    schedule.mockRestore();
  }
}

test("a provider-switched user follow-up publishes cumulative sandbox changes on its owned PR head", async () => {
  const f = await fixture();
  try {
    await f.tick();
    const firstHead = f.read().publishedHead!;
    const result = await finishUserFollowUp(f);
    expect(result.baseCommit).toBe(f.base);
    expect(result.headCommit).toBe(f.base);
    await f.tick();
    expect(f.read().detail).not.toContain("started before");
    expect(f.read().processedTurnId).toBe("follow-up");
    const git = ["git", "-C", f.read().workingPath!];
    expect(await checked([...git, "show", "-s", "--format=%P", "HEAD"])).toBe(
      firstHead,
    );
    expect(await checked([...git, "show", "HEAD:README.md"])).toBe(
      "Improved\n\nWorked example",
    );
    expect(f.counters.pushes).toBe(2);
    expect(f.counters.creates).toBe(1);
    expect(f.store.get("turn", "follow-up")!.execution?.provider).toBe(
      "claude",
    );
  } finally {
    await f.cleanup();
  }
});

test("a committed cumulative follow-up retains its recorded history and previous publication ancestry", async () => {
  const f = await fixture();
  try {
    await f.tick();
    const firstHead = f.read().publishedHead!;
    const result = await finishUserFollowUp(f, true);
    await f.tick();
    expect(f.read().processedTurnId).toBe("follow-up");
    const git = ["git", "-C", f.read().workingPath!];
    expect(
      (await checked([...git, "show", "-s", "--format=%P", "HEAD"])).split(" "),
    ).toEqual([firstHead, result.headCommit]);
    expect(await checked([...git, "diff", "HEAD", result.headCommit])).toBe("");
    expect(f.counters.pushes).toBe(2);
  } finally {
    await f.cleanup();
  }
});

test("a cumulative user follow-up still refuses a competing remote head", async () => {
  const f = await fixture();
  try {
    await f.tick();
    const firstHead = f.read().publishedHead;
    await finishUserFollowUp(f);
    f.setHead("9".repeat(40));
    await f.tick();
    expect(f.read().detail).toContain("changed outside this task");
    expect(f.read().publishedHead).toBe(firstHead);
    expect(f.read().processedTurnId).toBe("turn");
    expect(f.counters.pushes).toBe(1);
  } finally {
    await f.cleanup();
  }
});

test("a cumulative follow-up cannot replace a publication that differs from the previously captured result", async () => {
  const f = await fixture();
  try {
    await f.tick();
    const path = f.read().workingPath!;
    await Bun.write(join(path, "README.md"), "Another contributor's work\n");
    await checked(["git", "-C", path, "commit", "-am", "Another contribution"]);
    const otherHead = await checked(["git", "-C", path, "rev-parse", "HEAD"]);
    f.patch({ publishedHead: otherHead });
    f.setHead(otherHead);
    await finishUserFollowUp(f);
    await f.tick();
    expect(f.read().detail).toContain("started before");
    expect(f.read().publishedHead).toBe(otherHead);
    expect(f.counters.pushes).toBe(1);
  } finally {
    await f.cleanup();
  }
});

test("Autopilot can publish an initial result whose changes are already committed by the agent", async () => {
  const f = await fixture();
  try {
    await Bun.write(join(f.source, "README.md"), "Improved\n");
    await checked([
      "git",
      "-C",
      f.source,
      "commit",
      "-am",
      "Agent contribution",
    ]);
    const headCommit = await checked([
      "git",
      "-C",
      f.source,
      "rev-parse",
      "HEAD",
    ]);
    const original = f.store.get("turn", "turn")!;
    f.store.put("turn", original.id, {
      ...original,
      result: { ...original.result!, headCommit },
    });
    await f.tick();
    expect(f.read().publishedHead).toBe(headCommit);
    expect(f.counters.pushes).toBe(1);
    expect(f.counters.drafts).toBe(0);
  } finally {
    await f.cleanup();
  }
});

test("a failed follow-up blocks an existing PR until the task recovers", async () => {
  const f = await fixture();
  const schedule = spyOn(f.engine, "tick").mockResolvedValue();
  try {
    await f.tick();
    expect(f.counters.creates).toBe(1);
    f.patch({ mode: "merge", mergeAfter: null });
    const api = createApi(f.store, f.engine, "fixture");
    const response = await api(
      new Request(`http://localhost/tasks/${f.taskId}/follow-up`, {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ text: "Fix this before merging" }),
      }),
    );
    expect(response.status).toBe(200);
    const task = f.store.get("task", f.taskId)!;
    const original = f.store.get("turn", "turn")!;
    f.store.put("turn", "follow-up", {
      ...original,
      id: "follow-up",
      inputId: task.pending[0].id,
      prompt: task.pending[0].text,
      status: "running",
      result: null,
    });
    f.store.put("task", task.id, {
      ...task,
      activeTurnId: "follow-up",
      pending: [],
      status: "working",
    });
    f.engine.fail(task.id, "The agent stopped without a result.");
    await f.tick();
    await f.tick();
    expect(f.counters.merges).toBe(0);
    expect(f.counters.pushes).toBe(1);
    expect(f.store.get("task", task.id)?.status).toBe("failed");
    expect(f.read().status).toBe("blocked");
    expect(f.read().detail).toContain("Retry");
    expect(f.read().failures).toBe(0);

    const retried = await api(
      new Request(`http://localhost/tasks/${task.id}/retry`, {
        method: "POST",
        headers: { Authorization: "Bearer fixture" },
        body: "{}",
      }),
    );
    expect(retried.status).toBe(200);
    f.store.put("turn", "recovered", {
      ...f.store.get("turn", "follow-up")!,
      id: "recovered",
      inputId: f.store.get("task", task.id)!.pending[0].id,
      status: "finished",
      result: original.result,
    });
    f.store.put("task", task.id, {
      ...f.store.get("task", task.id)!,
      status: "ready",
      error: null,
      pending: [],
    });
    await f.tick();
    expect(f.read().processedTurnId).toBe("recovered");
    f.patch({ mergeAfter: null });
    await f.tick();
    expect(f.counters.merges).toBe(1);
  } finally {
    schedule.mockRestore();
    await f.cleanup();
  }
});

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
