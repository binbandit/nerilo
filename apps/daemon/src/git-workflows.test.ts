import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { taskSchema, turnSchema, projectSchema } from "@nerilo/protocol";
import { checked, dataDir } from "./config";
import { Store } from "./store";
import { gitStatus, gitAction, validateBranch } from "./git-workflows";
import { normalizePullRequest } from "./pull-requests";
import { Engine } from "./engine";

async function fixture() {
  const projectPath = await mkdtemp(join(tmpdir(), "nerilo-git-source-"));
  const parent = join(dataDir, "checkouts");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "test-git-"));
  const path = join(directory, "repo");
  const source = ["git", "-C", projectPath];
  await checked([...source, "init", "-b", "main"]);
  await checked([...source, "config", "user.name", "Test User"]);
  await checked([...source, "config", "user.email", "test@example.com"]);
  await Bun.write(join(projectPath, "hello.txt"), "Original\n");
  await checked([...source, "add", "."]);
  await checked([
    ...source,
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "Initial",
  ]);
  const head = await checked([...source, "rev-parse", "HEAD"]);
  await checked(["git", "clone", "--", projectPath, path]);
  await checked(["git", "-C", path, "remote", "remove", "origin"]);
  await checked(["git", "-C", path, "switch", "-c", "nerilo/test"]);
  const store = new Store(":memory:");
  const project = projectSchema.parse({
    id: "project",
    path: projectPath,
    name: "Test",
    branch: "main",
    createdAt: "now",
  });
  const task = taskSchema.parse({
    id: "task",
    projectId: project.id,
    title: "Improve validation",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "ready",
    sessionId: null,
    baseCommit: head,
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "now",
    updatedAt: "now",
    archived: false,
    error: null,
    stopRequested: false,
    checkout: { path, turnId: "turn", createdAt: "now" },
  });
  const turn = turnSchema.parse({
    id: "turn",
    taskId: task.id,
    inputId: "input",
    prompt: "Improve validation",
    status: "finished",
    container: "unused",
    cursor: 1,
    startedAt: "now",
    endedAt: "now",
    result: {
      exitCode: 0,
      sessionId: null,
      summary: "Improved validation.",
      diff: "",
      changes: [],
      verification: null,
      baseCommit: head,
      headCommit: head,
    },
  });
  store.put("project", project.id, project);
  store.put("task", task.id, task);
  store.put("turn", turn.id, turn);
  return {
    store,
    task,
    path,
    head,
    source,
    cleanup: async () => {
      store.db.close();
      await rm(directory, { recursive: true, force: true });
      await rm(projectPath, { recursive: true, force: true });
    },
  };
}

test("Git review detects new-file edits, preserves staging, and commits only the reviewed checkout tree", async () => {
  const f = await fixture();
  try {
    const git = ["git", "-C", f.path];
    await Bun.write(join(f.path, "hello.txt"), "Updated\n");
    await Bun.write(join(f.path, "new.txt"), "First draft\n");
    const before = await checked([...git, "diff", "--cached"]);
    const reviewed = await gitStatus(f.store, f.task.id);
    expect(reviewed.files).toContain("new.txt");
    expect(await checked([...git, "diff", "--cached"])).toBe(before);
    await Bun.write(join(f.path, "new.txt"), "Final draft\n");
    await expect(
      gitAction(f.store, f.task.id, {
        action: "commit",
        turnId: "turn",
        reviewToken: reviewed.reviewToken,
        message: "Improve validation",
      }),
    ).rejects.toThrow("checkout changed");
    const current = await gitStatus(f.store, f.task.id);
    const branched = await gitAction(f.store, f.task.id, {
      action: "branch",
      branch: "nerilo/validation",
      turnId: "turn",
      reviewToken: current.reviewToken,
    });
    expect(branched.branch).toBe("nerilo/validation");
    const committed = await gitAction(f.store, f.task.id, {
      action: "commit",
      turnId: "turn",
      reviewToken: branched.reviewToken,
      message: "Improve validation",
    });
    expect(committed.dirty).toBe(false);
    expect(committed.commits).toBe(1);
    expect(await checked([...git, "show", "HEAD:new.txt"])).toBe("Final draft");
    expect(await checked([...git, "log", "-1", "--format=%an <%ae>"])).toBe(
      "Test User <test@example.com>",
    );
    expect(await checked([...f.source, "rev-parse", "HEAD"])).toBe(f.head);
    expect(await checked([...f.source, "status", "--porcelain"])).toBe("");
  } finally {
    await f.cleanup();
  }
});

test("Git publication refuses synthetic snapshot ancestry and stale task checkouts", async () => {
  const f = await fixture();
  try {
    await checked([
      ...f.source,
      "remote",
      "add",
      "origin",
      "https://github.com/example/fixture.git",
    ]);
    await checked([
      "git",
      "-C",
      f.path,
      "-c",
      "user.name=Nerilo",
      "-c",
      "user.email=snapshot@nerilo.local",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      "Local working snapshot",
    ]);
    const state = await gitStatus(f.store, f.task.id);
    expect(state.publishBlocked).toContain("local working snapshot");
    await expect(
      gitAction(f.store, f.task.id, {
        action: "push",
        turnId: "turn",
        reviewToken: state.reviewToken,
      }),
    ).rejects.toThrow("local working snapshot");
    f.store.put("task", f.task.id, {
      ...f.task,
      pending: [
        { id: "next", text: "Continue", createdAt: "now", scheduledAt: null },
      ],
    });
    await expect(gitStatus(f.store, f.task.id)).rejects.toThrow("queued work");
  } finally {
    await f.cleanup();
  }
});

test("branch names cannot become Git flags or revision expressions", async () => {
  for (const branch of ["--force", "HEAD", "main~1", "task\nother", "@{-1}"])
    await expect(validateBranch(branch)).rejects.toThrow();
  await expect(
    validateBranch("nerilo/readable-task-name"),
  ).resolves.toBeUndefined();
});

test("exporting a repaired task reuses the saved branch and restores its exact baseline", async () => {
  const f = await fixture();
  const taskId = crypto.randomUUID();
  const saved = join(dataDir, "snapshots", `${taskId}.bundle`);
  let exported: string | undefined;
  try {
    const git = ["git", "-C", f.path];
    const branch = `nerilo/${taskId.slice(0, 8)}`;
    await checked([...git, "switch", "-c", branch]);
    await Bun.write(join(f.path, "hello.txt"), "Later branch state\n");
    await checked([...git, "add", "."]);
    await checked([
      ...git,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Later branch state",
    ]);
    await mkdir(join(dataDir, "snapshots"), { recursive: true });
    await checked([
      ...git,
      "bundle",
      "create",
      saved,
      "HEAD",
      `refs/heads/${branch}`,
    ]);
    const task = { ...f.task, id: taskId, checkout: null };
    const turn = {
      ...f.store.get("turn", "turn")!,
      id: `${taskId}-turn`,
      taskId,
    };
    f.store.put("task", taskId, task);
    f.store.put("turn", turn.id, turn);
    const checkout = await new Engine(f.store, true).checkout(
      task,
      f.store.get("project", task.projectId)!,
      turn.id,
    );
    exported = checkout.path;
    expect(
      await checked(["git", "-C", checkout.path, "branch", "--show-current"]),
    ).toBe(branch);
    expect(
      await checked(["git", "-C", checkout.path, "rev-parse", "HEAD"]),
    ).toBe(f.head);
    expect(await Bun.file(join(checkout.path, "hello.txt")).text()).toBe(
      "Original\n",
    );
  } finally {
    await rm(saved, { force: true });
    if (exported) await rm(dirname(exported), { recursive: true, force: true });
    await f.cleanup();
  }
});

test("Git actions preserve unfinished operations and an unmerged index", async () => {
  const f = await fixture();
  try {
    const state = await gitStatus(f.store, f.task.id);
    for (const marker of [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "REBASE_HEAD",
      "rebase-merge",
      "rebase-apply",
      "sequencer",
    ]) {
      const markerPath = join(f.path, ".git", marker);
      if (marker.includes("HEAD")) await Bun.write(markerPath, `${f.head}\n`);
      else await mkdir(markerPath);
      await expect(
        gitAction(f.store, f.task.id, {
          action: "branch",
          branch: "nerilo/must-not-create",
          turnId: "turn",
          reviewToken: state.reviewToken,
        }),
      ).rejects.toThrow("Finish or abort");
      await rm(markerPath, { recursive: true });
    }
    const git = ["git", "-C", f.path];
    const blob = await checked([...git, "rev-parse", "HEAD:hello.txt"]);
    await checked([...git, "update-index", "--index-info"], {
      input: `0 ${"0".repeat(40)}\thello.txt\n100644 ${blob} 1\thello.txt\n100644 ${blob} 2\thello.txt\n100644 ${blob} 3\thello.txt\n`,
    });
    const unmerged = await checked([...git, "ls-files", "--unmerged"]);
    await expect(gitStatus(f.store, f.task.id)).rejects.toThrow(
      "merge conflicts",
    );
    expect(await checked([...git, "ls-files", "--unmerged"])).toBe(unmerged);
    expect(
      await checked([...git, "branch", "--list", "nerilo/must-not-create"]),
    ).toBe("");
    expect(await checked([...git, "rev-parse", "HEAD"])).toBe(f.head);
  } finally {
    await f.cleanup();
  }
});

test("publication uses a non-force exact commit push and links a PR without duplicate creation", async () => {
  const f = await fixture();
  try {
    await checked([
      ...f.source,
      "remote",
      "add",
      "origin",
      "https://github.com/example/fixture.git",
    ]);
    const calls: string[][] = [];
    const url = "https://github.com/example/fixture/pull/42";
    let publishedHead = f.head;
    let pushed = false;
    let created = false;
    const network = {
      checked: async (args: string[]) => {
        calls.push(args);
        if (args.includes("defaultBranchRef")) return "main";
        if (args.includes("push")) {
          pushed = true;
          return "done";
        }
        if (args.includes("ls-remote"))
          return pushed ? `${publishedHead}\trefs/heads/nerilo/test` : "";
        if (args[1] === "pr" && args[2] === "list") return created ? url : "";
        if (args[1] === "pr" && args[2] === "create") {
          expect(
            await Bun.file(args[args.indexOf("--body-file") + 1]).text(),
          ).toBe("Summary\n\nValidation passed.");
          created = true;
          return url;
        }
        throw new Error(`Unexpected network command: ${args.join(" ")}`);
      },
      readPullRequest: async () =>
        normalizePullRequest({
          url,
          number: 42,
          title: "Improve validation",
          state: "OPEN",
          isDraft: false,
          reviewDecision: "",
          mergeable: "MERGEABLE",
          headRefName: "nerilo/test",
          baseRefName: "main",
          statusCheckRollup: [],
        }),
    };
    let state = await gitStatus(f.store, f.task.id);
    expect(state.commits).toBe(0);
    await expect(
      gitAction(
        f.store,
        f.task.id,
        { action: "push", turnId: "turn", reviewToken: state.reviewToken },
        network,
      ),
    ).rejects.toThrow("Create a commit");
    await expect(
      gitAction(
        f.store,
        f.task.id,
        {
          action: "pull-request",
          turnId: "turn",
          reviewToken: state.reviewToken,
          title: "Not ready",
          body: "",
          base: "main",
        },
        network,
      ),
    ).rejects.toThrow("Create a commit");
    expect(calls).toHaveLength(0);
    await Bun.write(join(f.path, "hello.txt"), "Ready to publish\n");
    state = await gitStatus(f.store, f.task.id);
    state = await gitAction(f.store, f.task.id, {
      action: "commit",
      turnId: "turn",
      reviewToken: state.reviewToken,
      message: "Improve validation",
    });
    expect(state.commits).toBe(1);
    publishedHead = state.head;
    const input = { turnId: "turn", reviewToken: state.reviewToken };
    const prInput = {
      ...input,
      action: "pull-request" as const,
      title: "Improve validation",
      body: "Summary\n\nValidation passed.",
      base: "main",
    };
    await expect(
      gitAction(f.store, f.task.id, prInput, network),
    ).rejects.toThrow("Push this branch");
    await gitAction(f.store, f.task.id, { ...input, action: "push" }, network);
    const push = calls.find((args) => args.includes("push"))!;
    expect(push.at(-1)).toBe(`${publishedHead}:refs/heads/nerilo/test`);
    expect(
      push.some((arg) => arg.startsWith("--force") || arg.startsWith("+")),
    ).toBe(false);
    await gitAction(f.store, f.task.id, prInput, network);
    await gitAction(f.store, f.task.id, prInput, network);
    expect(
      calls.filter((args) => args[1] === "pr" && args[2] === "create"),
    ).toHaveLength(1);
    expect(f.store.get("task", f.task.id)?.pullRequests).toHaveLength(1);
    expect(f.store.get("task", f.task.id)?.pullRequests[0].url).toBe(url);
    // A task started from a PR already has commits against its comparison base.
    const turn = f.store.get("turn", "turn")!;
    f.store.put("turn", turn.id, {
      ...turn,
      result: { ...turn.result!, baseCommit: publishedHead },
    });
    f.store.put("task", f.task.id, {
      ...f.store.get("task", f.task.id)!,
      source: {
        url,
        repository: "example/fixture",
        number: 42,
        headCommit: publishedHead,
        baseCommit: f.head,
      },
    });
    expect((await gitStatus(f.store, f.task.id)).commits).toBe(1);
    await gitAction(f.store, f.task.id, prInput, network);
    expect(f.store.get("task", f.task.id)?.pullRequests).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
