import { test, expect } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { taskSchema, turnSchema, projectSchema } from "@nerilo/protocol";
import { checked, command, dataDir } from "../platform/config";
import { Store } from "../platform/store";
import { gitStatus, gitAction, validateBranch } from "./git-workflows";
import { normalizePullRequest } from "./pull-requests";
import { Engine } from "../tasks/engine";
import { createApi } from "../http/api";

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

test("export and publication preserve a reviewed base merge and reject competing PR pushes", async () => {
  const f = await fixture();
  const taskId = crypto.randomUUID();
  const saved = join(dataDir, "snapshots", `${taskId}.bundle`);
  let exported: string | undefined;
  try {
    const git = ["git", "-C", f.path];
    await checked([...git, "config", "user.name", "Fixture"]);
    await checked([...git, "config", "user.email", "fixture@example.test"]);
    await Bun.write(join(f.path, "feature.txt"), "Feature behavior\n");
    await checked([...git, "add", "."]);
    await checked([...git, "commit", "-m", "Feature"]);
    const originalHead = await checked([...git, "rev-parse", "HEAD"]);
    await checked([...git, "switch", "-c", "teammate", f.head]);
    await Bun.write(join(f.path, "base.txt"), "Teammate behavior\n");
    await checked([...git, "add", "."]);
    await checked([...git, "commit", "-m", "Teammate base update"]);
    const currentBase = await checked([...git, "rev-parse", "HEAD"]);
    await checked([...git, "switch", "nerilo/test"]);
    await checked([...git, "merge", "--no-edit", "teammate"]);
    const mergedHead = await checked([...git, "rev-parse", "HEAD"]);
    await Bun.write(join(f.path, "hello.txt"), "Reviewed follow-up\n");
    const diff = await checked([...git, "diff", "--binary", originalHead]);
    await mkdir(join(dataDir, "snapshots"), { recursive: true });
    await checked([...git, "bundle", "create", saved, "--all"]);
    const project = {
      ...f.store.get("project", "project")!,
      repository: "example/fixture",
    };
    f.store.put("project", project.id, project);
    const task = taskSchema.parse({
      ...f.task,
      id: taskId,
      checkout: null,
      baseCommit: originalHead,
      source: {
        url: "https://github.com/example/fixture/pull/42",
        number: 42,
        repository: "example/fixture",
        headCommit: originalHead,
        baseCommit: currentBase,
        headBranch: "feature/imported",
        baseBranch: "main",
        headRepository: "example/fixture",
      },
    });
    const turn = {
      ...f.store.get("turn", "turn")!,
      id: `${taskId}-turn`,
      taskId,
      result: {
        ...f.store.get("turn", "turn")!.result!,
        diff: `${diff}\n`,
        baseCommit: originalHead,
        headCommit: mergedHead,
      },
    };
    f.store.put("task", task.id, task);
    f.store.put("turn", turn.id, turn);
    const checkout = await new Engine(f.store, true).checkout(
      task,
      project,
      turn.id,
    );
    exported = checkout.path;
    let state = await gitStatus(f.store, task.id);
    expect(state.branch).toBe("feature/imported");
    expect(state.head).toBe(mergedHead);
    state = await gitAction(f.store, task.id, {
      action: "commit",
      turnId: turn.id,
      reviewToken: state.reviewToken,
      message: "Finish reviewed repair",
    });
    const exportedGit = ["git", "-C", checkout.path];
    const remotePath = join(f.path, "..", "remote.git");
    await checked(["git", "init", "--bare", remotePath]);
    await checked([
      ...exportedGit,
      "push",
      remotePath,
      `${originalHead}:refs/heads/feature/imported`,
      `${currentBase}:refs/heads/main`,
    ]);
    expect(
      (
        await command([
          ...exportedGit,
          "merge-base",
          "--is-ancestor",
          currentBase,
          state.head,
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await command([
          ...exportedGit,
          "merge-base",
          "--is-ancestor",
          originalHead,
          state.head,
        ])
      ).code,
    ).toBe(0);
    expect(await checked([...exportedGit, "show", "HEAD:base.txt"])).toBe(
      "Teammate behavior",
    );
    expect(await checked([...exportedGit, "show", "HEAD:feature.txt"])).toBe(
      "Feature behavior",
    );
    expect(await checked([...exportedGit, "show", "HEAD:hello.txt"])).toBe(
      "Reviewed follow-up",
    );
    let remoteHead = originalHead;
    let losePushResponse = false;
    let competingPush = false;
    const pushes: string[][] = [];
    const network = {
      checked: async (args: string[]) => {
        if (args.includes("defaultBranchRef")) return "main";
        if (args.includes("ls-remote"))
          return `${remoteHead}\trefs/heads/feature/imported`;
        if (args[1] === "api")
          return JSON.stringify({
            state: "open",
            head: {
              ref: "feature/imported",
              sha: remoteHead,
              repo: { full_name: "example/fixture" },
            },
            base: { ref: "main", repo: { full_name: "example/fixture" } },
          });
        if (args.includes("push")) {
          pushes.push(args);
          if (competingPush)
            await checked([
              "git",
              "-C",
              remotePath,
              "update-ref",
              "refs/heads/feature/imported",
              currentBase,
              originalHead,
            ]);
          const output = await checked(
            args.map((arg) =>
              arg === "https://github.com/example/fixture.git"
                ? remotePath
                : arg,
            ),
          );
          remoteHead = state.head;
          if (losePushResponse) {
            losePushResponse = false;
            throw new Error("Push response lost");
          }
          return output;
        }
        throw new Error(`Unexpected operation ${args.join(" ")}`);
      },
      readPullRequest: async () => {
        throw new Error(
          "Must update the original PR without creating another.",
        );
      },
    };
    remoteHead = "a".repeat(40);
    await expect(
      gitAction(
        f.store,
        task.id,
        { action: "push", turnId: turn.id, reviewToken: state.reviewToken },
        network,
      ),
    ).rejects.toThrow("changed outside this task");
    expect(pushes).toHaveLength(0);
    remoteHead = originalHead;
    competingPush = true;
    await expect(
      gitAction(
        f.store,
        task.id,
        { action: "push", turnId: turn.id, reviewToken: state.reviewToken },
        network,
      ),
    ).rejects.toThrow();
    expect(
      await checked([
        "git",
        "-C",
        remotePath,
        "rev-parse",
        "refs/heads/feature/imported",
      ]),
    ).toBe(currentBase);
    competingPush = false;
    await checked([
      "git",
      "-C",
      remotePath,
      "update-ref",
      "refs/heads/feature/imported",
      originalHead,
      currentBase,
    ]);
    losePushResponse = true;
    await expect(
      gitAction(
        f.store,
        task.id,
        { action: "push", turnId: turn.id, reviewToken: state.reviewToken },
        network,
      ),
    ).rejects.toThrow("Push response lost");
    await gitAction(
      f.store,
      task.id,
      { action: "push", turnId: turn.id, reviewToken: state.reviewToken },
      network,
    );
    expect(pushes).toHaveLength(2);
    expect(pushes[0]).toContain(
      `--force-with-lease=refs/heads/feature/imported:${originalHead}`,
    );
    expect(pushes[0].at(-1)).toBe(`${state.head}:refs/heads/feature/imported`);
    expect(
      f.store.get("task", task.id)?.checkout?.pullRequest?.expectedHead,
    ).toBe(state.head);
    expect(
      await checked([
        "git",
        "-C",
        remotePath,
        "rev-parse",
        "refs/heads/feature/imported",
      ]),
    ).toBe(state.head);
    expect(
      (
        await command([
          "git",
          "-C",
          remotePath,
          "merge-base",
          "--is-ancestor",
          currentBase,
          state.head,
        ])
      ).code,
    ).toBe(0);
  } finally {
    await rm(saved, { force: true });
    if (exported) await rm(dirname(exported), { recursive: true, force: true });
    await f.cleanup();
  }
});

test("an ancestry-only result exports a publishable merge without inventing file changes", async () => {
  const f = await fixture();
  const taskId = crypto.randomUUID();
  const saved = join(dataDir, "snapshots", `${taskId}.bundle`);
  let exported: string | undefined;
  try {
    const git = ["git", "-C", f.path];
    await checked([...git, "config", "user.name", "Fixture"]);
    await checked([...git, "config", "user.email", "fixture@example.test"]);
    await checked([...git, "switch", "-c", "updated-base"]);
    await checked([
      ...git,
      "commit",
      "--allow-empty",
      "-m",
      "Base history advanced",
    ]);
    const targetBase = await checked([...git, "rev-parse", "HEAD"]);
    await checked([...git, "switch", "nerilo/test"]);
    await checked([...git, "merge", "--no-ff", "--no-edit", "updated-base"]);
    const mergedHead = await checked([...git, "rev-parse", "HEAD"]);
    await mkdir(join(dataDir, "snapshots"), { recursive: true });
    await checked([...git, "bundle", "create", saved, "--all"]);
    const task = { ...f.task, id: taskId, checkout: null };
    const original = f.store.get("turn", "turn")!;
    const turn = {
      ...original,
      id: `${taskId}-turn`,
      taskId,
      result: { ...original.result!, headCommit: mergedHead, diff: "" },
    };
    f.store.put("task", task.id, task);
    f.store.put("turn", turn.id, turn);
    const checkout = await new Engine(f.store, true).checkout(
      task,
      f.store.get("project", task.projectId)!,
      turn.id,
    );
    exported = checkout.path;
    const state = await gitStatus(f.store, task.id);
    expect(state.head).toBe(mergedHead);
    expect(state.dirty).toBe(false);
    expect(state.patch).toBe("");
    expect(state.commits).toBe(2);
    expect(state.preservesHistory).toBe(true);
    expect(
      (
        await command([
          "git",
          "-C",
          checkout.path,
          "merge-base",
          "--is-ancestor",
          targetBase,
          state.head,
        ])
      ).code,
    ).toBe(0);
  } finally {
    await rm(saved, { force: true });
    if (exported) await rm(dirname(exported), { recursive: true, force: true });
    await f.cleanup();
  }
});

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

test("GitHub-only projects commit with identity from included global configuration", async () => {
  const f = await fixture();
  const previousGlobal = process.env.GIT_CONFIG_GLOBAL;
  const configDirectory = await mkdtemp(join(tmpdir(), "nerilo-git-identity-"));
  try {
    const included = join(configDirectory, "identity.conf");
    const global = join(configDirectory, "gitconfig");
    await Bun.write(
      included,
      "[user]\nname = Included User\nemail = included@example.com\n",
    );
    await Bun.write(global, `[include]\npath = ${included}\n`);
    process.env.GIT_CONFIG_GLOBAL = global;
    const project = f.store.get("project", "project")!;
    f.store.put("project", project.id, {
      ...project,
      path: "",
      repository: "example/fixture",
    });
    await Bun.write(join(f.path, "hello.txt"), "Updated remotely\n");
    const reviewed = await gitStatus(f.store, f.task.id);
    const committed = await gitAction(f.store, f.task.id, {
      action: "commit",
      turnId: "turn",
      reviewToken: reviewed.reviewToken,
      message: "Use configured identity",
    });
    expect(committed.dirty).toBe(false);
    expect(
      await checked([
        "git",
        "-C",
        f.path,
        "log",
        "-1",
        "--format=%an <%ae>|%cn <%ce>",
      ]),
    ).toBe(
      "Included User <included@example.com>|Included User <included@example.com>",
    );
  } finally {
    if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
    else process.env.GIT_CONFIG_GLOBAL = previousGlobal;
    await rm(configDirectory, { recursive: true, force: true });
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
    const prBody =
      "## Summary\n\n" +
      "- Detailed change.\n".repeat(1000) +
      "\n## Validation\n\n- [x] Tests passed.\n";
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
          ).toBe(prBody);
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
      body: prBody,
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

test("PR template endpoint reads only the task's managed checkout", async () => {
  const f = await fixture();
  try {
    const body = "## Summary\n\n- [ ] Verified\n";
    await mkdir(join(f.path, ".github"), { recursive: true });
    await Bun.write(join(f.path, ".github/PULL_REQUEST_TEMPLATE.md"), body);
    await checked(["git", "-C", f.path, "add", "."]);
    await checked([
      "git",
      "-C",
      f.path,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Template",
    ]);
    const api = createApi(f.store, new Engine(f.store, true), "test");
    const read = () =>
      api(
        new Request("http://localhost/tasks/task/git/templates", {
          headers: { Authorization: "Bearer test" },
        }),
      );
    const response = await read();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      { path: ".github/PULL_REQUEST_TEMPLATE.md", body },
    ]);
    // A valid large Unicode body must reach Git validation, not fail at the
    // transport's smaller default byte limit.
    const longRequest = await api(
      new Request("http://localhost/tasks/task/git", {
        method: "POST",
        headers: { Authorization: "Bearer test" },
        body: JSON.stringify({
          action: "pull-request",
          turnId: "turn",
          reviewToken: "stale",
          title: "Change",
          base: "main",
          body: "改".repeat(60000),
        }),
      }),
    );
    expect(longRequest.status).toBe(400);
    expect(await longRequest.json()).toMatchObject({
      error: "The checkout changed. Refresh and review it before continuing.",
    });
    f.store.put("task", f.task.id, { ...f.task, checkout: null });
    expect((await read()).status).toBe(400);
  } finally {
    await f.cleanup();
  }
});
