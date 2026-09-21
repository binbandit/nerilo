import "../testing/setup";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
const directory = await mkdtemp(join(tmpdir(), "nerilo-smoke-"));
process.env.NERILO_DATA_DIR = join(directory, "data");
const { Store } = await import("../../apps/daemon/src/platform/store");
const { Engine } = await import("../../apps/daemon/src/tasks/engine");
const { configureAutonomy, tickAutonomy, autonomyStatus } =
  await import("../../apps/daemon/src/tasks/autonomy");
const { decidePullRequest } =
  await import("../../apps/daemon/src/git/pr-observer");
const { normalizePullRequest } =
  await import("../../apps/daemon/src/git/pull-requests");
const { bundleWorkspaceHistory } =
  await import("../../apps/daemon/src/git/workspace-history");
const { createApi } = await import("../../apps/daemon/src/http/api");
const { checked, command } =
  await import("../../apps/daemon/src/platform/config");
const { taskSchema, projectSchema, turnSchema } =
  await import("../../packages/protocol/src/index");
let store = new Store(join(directory, "test.sqlite"));
let engine = new Engine(store, true);
let api = createApi(store, engine, "test-token");
const created: string[] = [];
const phases: Array<{
  phase: string;
  outcome: "ready" | "timeout" | "error";
  elapsedMs: number;
  wallElapsedMs: number;
  polls: number;
  slowestTickMs: number;
}> = [];
async function post(path: string, body: unknown, key = crypto.randomUUID()) {
  const response = await api(
    new Request("http://127.0.0.1" + path, {
      method: "POST",
      headers: { Authorization: "Bearer test-token", "Idempotency-Key": key },
      body: JSON.stringify(body),
    }),
  );
  const data: unknown = await response.json();
  assert(response.ok, JSON.stringify(data));
  return data;
}
async function until(phase: string, predicate: () => boolean, timeout = 25000) {
  const started = performance.now();
  const wallStarted = Date.now();
  const deadline = wallStarted + timeout;
  let polls = 0;
  let slowestTickMs = 0;
  let outcome: "ready" | "timeout" | "error" = "error";
  try {
    while (Date.now() < deadline) {
      const tickStarted = performance.now();
      await engine.tick();
      slowestTickMs = Math.max(slowestTickMs, performance.now() - tickStarted);
      polls++;
      if (predicate()) {
        outcome = "ready";
        return;
      }
      await Bun.sleep(150);
    }
    outcome = "timeout";
    throw new Error(`Timed out waiting for ${phase} after ${timeout} ms.`);
  } finally {
    phases.push({
      phase,
      outcome,
      elapsedMs: Math.round(performance.now() - started),
      wallElapsedMs: Date.now() - wallStarted,
      polls,
      slowestTickMs: Math.round(slowestTickMs),
    });
  }
}
try {
  const repo = join(directory, "project");
  await mkdir(repo);
  await checked(["git", "init", repo]);
  await checked([
    "git",
    "-C",
    repo,
    "config",
    "user.email",
    "test@nerilo.local",
  ]);
  await checked(["git", "-C", repo, "config", "user.name", "Nerilo test"]);
  await writeFile(join(repo, "README.md"), "# Fixture\n");
  await writeFile(join(repo, ".gitignore"), ".env\n");
  await checked(["git", "-C", repo, "add", "."]);
  await checked(["git", "-C", repo, "commit", "-m", "Initial fixture"]);
  await writeFile(join(repo, "new-local.txt"), "Uncommitted source\n");
  await writeFile(join(repo, ".env"), "Ignored local value\n");
  const project = projectSchema.parse(
    await post("/projects", {
      name: "Smoke fixture",
      path: repo,
      verify: "test -s nerilo-smoke.txt",
    }),
  );
  const key = crypto.randomUUID();
  const task = taskSchema.parse(
    await post(
      "/tasks",
      {
        projectId: project.id,
        presetId: "programmer",
        prompt: "First task",
      },
      key,
    ),
  );
  created.push(task.id);
  const duplicate = taskSchema.parse(
    await post(
      "/tasks",
      { projectId: project.id, presetId: "programmer", prompt: "First task" },
      key,
    ),
  );
  assert.equal(duplicate.id, task.id);
  await until("first agent start", () =>
    store
      .all("turn")
      .some((t) => t.taskId === task.id && t.status === "running"),
  );
  await post(`/tasks/${task.id}/execution`, {
    provider: "claude",
    model: "sonnet",
    effort: "medium",
  });
  assert.equal(store.get("task", task.id)?.provider, "claude");
  assert.equal(
    store.all("turn").find((turn) => turn.taskId === task.id)?.execution
      ?.provider,
    "codex",
  );
  store.db.close();
  store = new Store(join(directory, "test.sqlite"));
  engine = new Engine(store, true);
  api = createApi(store, engine, "test-token");
  await until(
    "first result after daemon restart",
    () => store.get("task", task.id)?.status === "ready",
  );
  const first = store.all("turn").find((t) => t.taskId === task.id)!;
  assert.equal(first.result?.verification?.exitCode, 0);
  assert(first.result?.diff.includes("nerilo-smoke.txt"));
  assert(!first.result?.diff.includes("new-local.txt"));
  assert(!first.result?.diff.includes("Ignored local value"));
  assert.equal(await readFile(join(repo, "README.md"), "utf8"), "# Fixture\n");
  assert.equal(
    await command(["test", "-f", join(repo, "nerilo-smoke.txt")]).then(
      (r) => r.code,
    ),
    1,
  );
  const inspection = JSON.parse(
    await checked(["docker", "inspect", first.container]),
  )[0] as {
    HostConfig: { ReadonlyRootfs: boolean; CapDrop: string[] };
    Mounts: { Destination: string; Type: string }[];
  };
  assert(inspection.HostConfig.ReadonlyRootfs);
  assert(inspection.HostConfig.CapDrop.includes("ALL"));
  assert(
    inspection.Mounts.every(
      (m) => m.Type === "volume" && !m.Destination.includes("docker.sock"),
    ),
  );
  const publicationRemote = join(directory, "publication.git");
  await checked(["git", "init", "--bare", publicationRemote]);
  const publicationBranch = `nerilo/${task.id.slice(0, 8)}`;
  const publicationUrl = "https://github.com/example/fixture/pull/1";
  let publishedHead: string | null = null;
  let pullRequestsCreated = 0;
  const publicationIO: NonNullable<Parameters<typeof tickAutonomy>[2]> = {
    remoteResult: async () => ({
      code: publishedHead ? 0 : 1,
      stdout: publishedHead ?? "",
      stderr: publishedHead ? "" : "HTTP 404",
    }),
    remote: async (args, options) => {
      if (args.includes("push")) {
        const output = await checked(
          args.map((arg) =>
            arg === "https://github.com/example/fixture.git"
              ? publicationRemote
              : arg,
          ),
          options,
        );
        publishedHead = await checked([
          "git",
          "--git-dir",
          publicationRemote,
          "rev-parse",
          publicationBranch,
        ]);
        return output;
      }
      if (args[1] === "api") return first.result!.baseCommit;
      if (args[1] === "pr" && args[2] === "list")
        return pullRequestsCreated ? publicationUrl : "";
      if (args[1] === "pr" && args[2] === "create") {
        pullRequestsCreated++;
        return publicationUrl;
      }
      throw new Error(`Unexpected publication operation: ${args.join(" ")}`);
    },
    draft: async () => ({
      branch: publicationBranch,
      commitTitle: "Publish verified smoke result",
      prTitle: "Smoke contribution",
      prBody: "Verified contribution from the retained task workspace.",
    }),
    readPR: async () =>
      normalizePullRequest({
        url: publicationUrl,
        number: 1,
        title: "Smoke contribution",
        state: "OPEN",
        isDraft: false,
        reviewDecision: "",
        mergeable: "MERGEABLE",
        headRefName: publicationBranch,
        baseRefName: project.branch,
        statusCheckRollup: [],
      }),
    observe: async () =>
      decidePullRequest({
        url: publicationUrl,
        repository: "example/fixture",
        number: 1,
        title: "Smoke contribution",
        observedAt: new Date().toISOString(),
        state: "OPEN",
        draft: false,
        headSha: publishedHead!,
        baseSha: first.result!.baseCommit,
        prBaseSha: first.result!.baseCommit,
        headBranch: publicationBranch,
        baseBranch: project.branch,
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
  store.put("project", project.id, {
    ...project,
    repository: "example/fixture",
  });
  await configureAutonomy(store, task.id, { mode: "pr" }, publicationIO);
  store.put("project", project.id, project);
  await tickAutonomy(store, engine, publicationIO);
  assert(
    publishedHead,
    autonomyStatus(store, task.id)?.detail ?? "Publication was not created",
  );
  const firstPublication = publishedHead;
  assert.notEqual(firstPublication, first.result!.headCommit);
  await post(`/tasks/${task.id}/follow-up`, { text: "Second turn" });
  await until(
    "provider-switched follow-up",
    () =>
      store.all("turn").filter((t) => t.taskId === task.id).length === 2 &&
      store.get("task", task.id)?.status === "ready",
  );
  const second = store
    .all("turn")
    .filter((t) => t.taskId === task.id)
    .at(-1)!;
  assert(second.result?.diff.includes("Second turn"));
  assert(second.result?.diff.includes("First task"));
  assert.deepEqual(second.execution, {
    provider: "claude",
    model: "sonnet",
    effort: "medium",
  });
  assert.equal(first.execution?.provider, "codex");
  assert(store.events(task.id).filter((e) => e.kind === "user").length === 2);
  assert.equal(second.result?.headCommit, first.result?.headCommit);
  await tickAutonomy(store, engine, publicationIO);
  assert.notEqual(
    publishedHead,
    firstPublication,
    autonomyStatus(store, task.id)?.detail ?? "Follow-up was not published",
  );
  assert.equal(pullRequestsCreated, 1);
  assert.equal(
    await checked([
      "git",
      "--git-dir",
      publicationRemote,
      "show",
      "-s",
      "--format=%P",
      publishedHead!,
    ]),
    firstPublication,
  );
  const publishedFiles = await checked([
    "git",
    "--git-dir",
    publicationRemote,
    "show",
    `${publishedHead}:nerilo-smoke.txt`,
  ]);
  assert(publishedFiles.includes("First task"));
  assert(publishedFiles.includes("Second turn"));
  const preview = await engine.file(
    store.get("task", task.id)!,
    "nerilo-smoke.txt",
  );
  assert(preview.content.includes("Second turn"));
  await assert.rejects(() =>
    engine.file(store.get("task", task.id)!, "../etc/passwd"),
  );
  const local = await engine.checkout(
    store.get("task", task.id)!,
    project,
    second.id,
  );
  const history = await bundleWorkspaceHistory(
    task.id,
    second.result!.headCommit,
    directory,
  );
  await checked(["git", "-C", local.path, "bundle", "verify", history]);
  await checked(["git", "-C", local.path, "fetch", history, "HEAD"]);
  assert.equal(
    await checked(["git", "-C", local.path, "rev-parse", "FETCH_HEAD"]),
    second.result!.headCommit,
  );
  await assert.rejects(
    () => bundleWorkspaceHistory(task.id, "a".repeat(40), directory),
    /workspace revision changed/,
  );
  assert(
    (await readFile(join(local.path, "nerilo-smoke.txt"), "utf8")).includes(
      "Second turn",
    ),
  );
  await writeFile(join(local.path, "local-edit.txt"), "Retain my edits\n");
  const another = await engine.checkout(
    store.get("task", task.id)!,
    project,
    second.id,
  );
  assert.notEqual(another.path, local.path);
  assert.equal(
    await readFile(join(local.path, "local-edit.txt"), "utf8"),
    "Retain my edits\n",
  );
  await assert.rejects(
    () => engine.checkout(store.get("task", task.id)!, project, first.id),
    /latest turn/,
  );
  await rm(join(repo, "new-local.txt"));
  await post(`/tasks/${task.id}/apply`, { turnId: second.id });
  assert(
    (await readFile(join(repo, "nerilo-smoke.txt"), "utf8")).includes(
      "Second turn",
    ),
  );
  const failedApply = await api(
    new Request(`http://127.0.0.1/tasks/${task.id}/apply`, {
      method: "POST",
      headers: { Authorization: "Bearer test-token" },
      body: JSON.stringify({ turnId: second.id }),
    }),
  );
  assert.equal(failedApply.status, 400);
  await writeFile(join(repo, "new-local.txt"), "Uncommitted source\n");
  const snapshotTask = taskSchema.parse(
    await post("/tasks", {
      projectId: project.id,
      presetId: "programmer",
      prompt: "Use local source",
      includeChanges: true,
      includeUntracked: true,
    }),
  );
  created.push(snapshotTask.id);
  await until(
    "local snapshot result",
    () => store.get("task", snapshotTask.id)?.status === "ready",
  );
  const snapshotTurn = store
    .all("turn")
    .find((turn) => turn.taskId === snapshotTask.id)!;
  assert(!snapshotTurn.result?.diff.includes("new-local.txt"));
  assert(snapshotTurn.result?.diff.includes("Use local source"));
  const snapshotCheckout = await engine.checkout(
    store.get("task", snapshotTask.id)!,
    project,
    snapshotTurn.id,
  );
  assert.equal(
    await readFile(join(snapshotCheckout.path, "new-local.txt"), "utf8"),
    "Uncommitted source\n",
  );
  assert.equal(
    (await command(["test", "-f", join(snapshotCheckout.path, ".env")])).code,
    1,
  );
  assert.equal(
    await readFile(join(repo, "new-local.txt"), "utf8"),
    "Uncommitted source\n",
  );
  await post(`/projects/${project.id}`, { ...project, verify: "exit 7" });
  const failed = taskSchema.parse(
    await post("/tasks", {
      projectId: project.id,
      presetId: "programmer",
      prompt: "Fail verification",
    }),
  );
  created.push(failed.id);
  await until(
    "failed verification result",
    () => store.get("task", failed.id)?.status === "check_failed",
  );
  assert.equal(
    store.all("turn").find((t) => t.taskId === failed.id)?.status,
    "finished",
  );
  assert.equal(store.get("task", failed.id)?.error, null);
  assert.equal(
    store.all("turn").find((t) => t.taskId === failed.id)?.result?.verification
      ?.exitCode,
    7,
  );
  await post(`/projects/${project.id}`, {
    ...project,
    verify: "test -s nerilo-smoke.txt",
  });
  const paused = taskSchema.parse(
    await post("/tasks", {
      projectId: project.id,
      presetId: "programmer",
      prompt: "Pause and resume",
    }),
  );
  created.push(paused.id);
  await until("pause fixture start", () =>
    store
      .all("turn")
      .some((t) => t.taskId === paused.id && t.status === "running"),
  );
  await post(`/tasks/${paused.id}/pause`, {});
  await until(
    "pause acknowledgement",
    () => store.get("task", paused.id)?.status === "paused",
  );
  await post(`/tasks/${paused.id}/retry`, {});
  await until(
    "resume result",
    () => store.get("task", paused.id)?.status === "ready",
  );
  assert.equal(
    store.all("turn").filter((t) => t.taskId === paused.id).length,
    2,
  );
  // A terminal event is not permission to reuse a still-running workspace.
  for (const linger of [true, false]) {
    const taskId = crypto.randomUUID();
    const turnId = crypto.randomUUID();
    const container = `nerilo-lifecycle-${taskId}`;
    created.push(taskId);
    store.put("task", taskId, {
      ...task,
      id: taskId,
      status: "working",
      pending: [],
      activeTurnId: turnId,
      stopRequested: !linger,
    });
    store.put(
      "turn",
      turnId,
      turnSchema.parse({
        ...first,
        id: turnId,
        taskId,
        container,
        status: "running",
        cursor: 0,
        result: null,
      }),
    );
    await checked([
      "docker",
      "run",
      "-d",
      "--name",
      container,
      "--network=none",
      "--entrypoint",
      "node",
      process.env.NERILO_AGENT_IMAGE ?? "nerilo-agent:1",
      "-e",
      `console.log(${JSON.stringify(JSON.stringify({ type: "result", result: first.result }))}); setTimeout(() => {}, ${linger ? 10000 : 0});`,
    ]);
    for (let i = 0; i < 50; i++) {
      if ((await checked(["docker", "logs", container])).includes('"result"'))
        break;
      await Bun.sleep(100);
    }
    if (!linger) await checked(["docker", "wait", container]);
    await engine.tick();
    if (linger) {
      assert.equal(
        store.get("task", taskId)?.activeTurnId,
        turnId,
        "A result must wait for container exit",
      );
      await post(`/tasks/${taskId}/follow-up`, {
        text: "Keep this follow-up queued",
      });
      await post(`/tasks/${taskId}/pause`, {});
      await until(
        "lingering container pause",
        () => store.get("task", taskId)?.status === "paused",
      );
      assert.equal(store.get("task", taskId)?.pending.length, 1);
    }
    assert.equal(store.get("task", taskId)?.status, "paused");
    assert(
      store.get("turn", turnId)?.result,
      "Pausing must retain an already-emitted result",
    );
  }
  console.log("Docker phase timing: " + JSON.stringify(phases));
  console.log(
    "PASS: real Docker isolation, durable restart, idempotent submission, provider handoff with history, immutable turn settings, cumulative follow-up publication preserving the existing PR head, verification, patch export/application, binary history transfer, stale workspace rejection, file previews, pause/resume, and dirty-checkout protection.",
  );
} catch (error) {
  // Capture only this run's fixture status and logs before removing its containers.
  // Never dump Docker configuration, environment variables, or credential files.
  try {
    const turns = store
      .all("turn")
      .filter((turn) => created.includes(turn.taskId));
    const containers = await Promise.all(
      turns.map(async (turn) => {
        const [state, logs] = await Promise.all([
          command(
            [
              "docker",
              "inspect",
              "--format",
              "{{json .State}}",
              turn.container,
            ],
            { timeout: 5000 },
          ),
          command(
            ["docker", "logs", "--timestamps", "--tail", "30", turn.container],
            { timeout: 5000, outputTail: 10000 },
          ),
        ]);
        return { container: turn.container, state, logs };
      }),
    );
    const evidence = join(
      tmpdir(),
      `nerilo-docker-failure-${crypto.randomUUID()}.json`,
    );
    await writeFile(
      evidence,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          error: String(error),
          image: process.env.NERILO_AGENT_IMAGE ?? "nerilo-agent:1",
          phases,
          tasks: store
            .all("task")
            .filter((task) => created.includes(task.id))
            .map((task) => ({
              id: task.id,
              status: task.status,
              error: task.error,
              activeTurnId: task.activeTurnId,
              updatedAt: task.updatedAt,
            })),
          turns: turns.map((turn) => ({
            id: turn.id,
            taskId: turn.taskId,
            status: turn.status,
            provider: turn.execution?.provider,
            container: turn.container,
            cursor: turn.cursor,
            startedAt: turn.startedAt,
            endedAt: turn.endedAt,
            resultExitCode: turn.result?.exitCode,
            verificationExitCode: turn.result?.verification?.exitCode,
          })),
          containers,
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    console.error(`Docker smoke failure evidence retained at ${evidence}`);
  } catch (diagnosticError) {
    console.error(
      `Could not capture smoke failure evidence: ${String(diagnosticError)}`,
    );
  }
  throw error;
} finally {
  for (const id of created) {
    for (const turn of store.all("turn").filter((t) => t.taskId === id))
      await command(["docker", "rm", "-f", turn.container]);
    await command([
      "docker",
      "volume",
      "rm",
      `nerilo-work-${id}`,
      `nerilo-home-${id}`,
    ]);
  }
  store.db.close();
  await rm(directory, { recursive: true, force: true });
}
