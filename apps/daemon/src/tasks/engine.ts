import { providerNames } from "@nerilo/protocol";
import {
  mkdir,
  copyFile,
  rm,
  realpath,
  mkdtemp,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  activeStatuses,
  resultSchema,
  type Task,
  type Turn,
  type Runtime,
  type Project,
  type TaskMetadata,
} from "@nerilo/protocol";
import { Store } from "../platform/store";
import {
  checked,
  command,
  dataDir,
  imageTag,
  rootDir,
  now,
} from "../platform/config";
import { bundleRevision } from "../git/revision-bundle";
import { bundleWorkspaceHistory } from "../git/workspace-history";
import { validateBranch } from "../git/git-workflows";
import { withTaskGithubAccount } from "../git/github-context";
import { bundleWorkingChanges } from "../git/working-changes";
import { readRemoteProject } from "../projects/remote-projects";
import { connection, credentials } from "../agents/credentials";
import { generateTaskMetadata } from "../agents/ai-suggestions";
import { summarizeTask } from "./task-metadata";
import {
  sandboxLimits,
  prepareReadOnlyWorkspace,
  bootstrapReadOnly,
} from "../sandbox/sandbox";
import { claudeLoginMounts } from "../agents/claude-login";
import { isTaskLocked } from "./task-locks";
import {
  createProviderNetwork,
  providerNetworkArgs,
  cleanupProviderNetwork,
} from "../sandbox/sandbox-network";
import { reconcileVerification } from "./verification";
import { refreshStateSummary } from "./state-summary";
import { dueInput } from "./queue-actions";
import { requireAvailableProject } from "../projects/project-lifecycle";
import { taskAgentTools } from "../tools/agent-tools";
import { listWorkspaceFiles, readWorkspaceFile } from "./workspace-files";

const runnerEvent = z.object({
  type: z.string(),
  text: z.string().optional(),
  phase: z.string().optional(),
  id: z.string().optional(),
  commit: z.string().optional(),
  result: resultSchema.optional(),
});
export class Engine {
  private ticking = false;
  private launching = new Set<string>();
  private summaries = new Map<string, Promise<TaskMetadata>>();
  building = false;
  buildLog = "";
  private cachedRuntime: Runtime | null = null;
  private checkedAt = 0;
  constructor(
    readonly store: Store,
    readonly fixture = false,
  ) {}
  async summarize(taskId: string, rename: boolean | "preview" = false) {
    const task = this.store.get("task", taskId);
    if (!task) throw new Error("Task no longer exists.");
    return summarizeTask(
      this.store,
      taskId,
      (input, turn) => {
        const pending = this.summaries.get(turn.id);
        if (pending) return pending;
        const execution = turn.execution ?? task;
        const generation = this.fixture
          ? Promise.resolve({
              title: "Verify isolated workspace",
              promptSummary: "Verify the requested workspace changes",
            })
          : generateTaskMetadata(execution.provider, execution.model, input);
        this.summaries.set(turn.id, generation);
        void generation
          .finally(() => this.summaries.delete(turn.id))
          .catch(() => {});
        return generation;
      },
      rename,
    );
  }
  async runtime(force = false): Promise<Runtime> {
    if (!force && this.cachedRuntime && Date.now() - this.checkedAt < 5000)
      return {
        ...this.cachedRuntime,
        building: this.building,
        buildLog: this.buildLog,
      };
    const [docker, image, codex, claude, opencode, pi] = await Promise.all([
      command(["docker", "info", "--format", "{{.ServerVersion}}"], {
        timeout: 4000,
      }).catch(() => ({ code: 1 })),
      command(["docker", "image", "inspect", imageTag], {
        timeout: 4000,
      }).catch(() => ({ code: 1 })),
      connection("codex"),
      connection("claude"),
      connection("opencode"),
      connection("pi"),
    ]);
    this.cachedRuntime = {
      docker: docker.code === 0,
      image: image.code === 0,
      building: this.building,
      buildLog: this.buildLog,
      connections: { codex, claude, opencode, pi },
    };
    this.checkedAt = Date.now();
    return this.cachedRuntime;
  }
  async build() {
    if (this.building) return;
    this.building = true;
    this.buildLog = "Building the agent environment…\n";
    try {
      const child = Bun.spawn(
        [
          "docker",
          "build",
          "-t",
          imageTag,
          "-f",
          join(rootDir, "containers/Dockerfile"),
          join(rootDir, "containers"),
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const read = async (stream: ReadableStream<Uint8Array>) => {
        for await (const chunk of stream)
          this.buildLog = (
            this.buildLog + new TextDecoder().decode(chunk)
          ).slice(-30000);
      };
      await Promise.all([read(child.stdout), read(child.stderr)]);
      const code = await child.exited;
      if (code !== 0)
        this.buildLog += "\nBuild failed. Review the output and try again.";
    } catch (e) {
      this.buildLog += String(e);
    } finally {
      this.building = false;
      this.checkedAt = 0;
    }
  }
  async validateProject(
    path: string,
  ): Promise<{ path: string; branch: string }> {
    let canonical: string;
    try {
      canonical = await realpath(path);
    } catch {
      throw new Error("Choose an existing project folder.");
    }
    let root: string;
    try {
      root = await checked([
        "git",
        "-C",
        canonical,
        "rev-parse",
        "--show-toplevel",
      ]);
    } catch {
      throw new Error("Choose a Git repository.");
    }
    if ((await realpath(root)) !== canonical)
      throw new Error("Choose the repository root folder.");
    try {
      await checked(["git", "-C", canonical, "rev-parse", "HEAD"]);
    } catch {
      throw new Error("Create an initial commit in this repository.");
    }
    return {
      path: canonical,
      branch:
        (await checked(["git", "-C", canonical, "branch", "--show-current"])) ||
        "Detached HEAD",
    };
  }
  log(
    taskId: string,
    turnId: string | null,
    kind: "system" | "activity" | "error",
    text: string,
  ) {
    this.store.event({ taskId, turnId, kind, text });
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      for (const task of this.store
        .all("task")
        .filter((task) => task.activeTurnId))
        void refreshStateSummary(this.store, task.id, {
          fixture: this.fixture,
        });
      for (const task of this.store
        .all("task")
        .filter((t) => t.activeTurnId && !this.launching.has(t.id)))
        await this.reconcile(task);
      const settings = this.store.get("settings", "default")!;
      const active = this.store
        .all("task")
        .filter((t) => t.activeTurnId).length;
      const queued = this.store
        .all("task")
        .filter(
          (t) =>
            !t.archived &&
            !this.store.get("project", t.projectId)?.archived &&
            !isTaskLocked(t.id) &&
            t.status === "queued" &&
            !t.activeTurnId &&
            dueInput(t.pending),
        )
        .slice(0, Math.max(0, settings.concurrency - active));
      if (!queued.length) return;
      const runtime = await this.runtime();
      if (!runtime.docker || !runtime.image) return;
      for (const candidate of queued) {
        // Runtime checks await Docker and credentials; queue edits can arrive meanwhile.
        const task = this.store.get("task", candidate.id);
        if (
          !task ||
          task.archived ||
          this.store.get("project", task.projectId)?.archived ||
          isTaskLocked(task.id) ||
          task.status !== "queued" ||
          task.activeTurnId ||
          !dueInput(task.pending)
        )
          continue;
        if (!this.fixture && !runtime.connections[task.provider].ready) {
          this.store.put("task", task.id, {
            ...task,
            status: "failed",
            error: `Connect ${providerNames[task.provider]} in Settings, then retry.`,
            updatedAt: now(),
          });
          this.log(task.id, null, "error", "Agent connection is missing.");
          continue;
        }
        this.launching.add(task.id);
        void withTaskGithubAccount(this.store, task.id, () => this.launch(task))
          .catch((error) => this.launchFailed(task.id, error))
          .finally(() => this.launching.delete(task.id));
      }
    } finally {
      this.ticking = false;
    }
  }
  private async launch(task: Task) {
    const project = requireAvailableProject(this.store, task.projectId);
    const input = dueInput(task.pending);
    if (!input) return;
    const id = crypto.randomUUID();
    const settings = this.store.get("settings", "default")!;
    const sandbox = task.sandbox ?? settings.sandbox;
    const { skills, mcpServers } = taskAgentTools(
      settings,
      task.tools,
      sandbox,
    );
    if (task.provider === "pi" && mcpServers.some((server) => server.enabled))
      throw new Error(
        "Pi does not support MCP servers. Deselect MCP servers in this task’s tools to continue.",
      );
    const turn: Turn = {
      id,
      check: null,
      sandbox,
      execution: {
        provider: task.provider,
        model: task.model,
        effort: task.effort,
      },
      taskId: task.id,
      inputId: input.id,
      prompt: input.text,
      requestOrigin: input.requestOrigin,
      status: "preparing",
      container: `nerilo-${task.id}-${id}`,
      cursor: 0,
      startedAt: now(),
      endedAt: null,
      result: null,
    };
    this.store.transaction(() => {
      this.store.put("turn", id, turn);
      this.store.put("task", task.id, {
        ...task,
        pending: task.pending.filter((item) => item.id !== input.id),
        activeTurnId: id,
        status: "preparing",
        error: null,
        stopRequested: false,
        updatedAt: now(),
      });
      this.log(task.id, id, "system", "Preparing an isolated workspace.");
    });
    const image = await checked([
      "docker",
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      imageTag,
    ]);
    const secret = this.fixture
      ? { apiKey: null, codexAuth: null, claudeLogin: false, gateway: null }
      : await credentials(task.provider);
    const connectionId = secret.gateway?.revision ?? "direct";
    this.store.put("turn", id, {
      ...this.store.get("turn", id)!,
      connectionId,
    });
    const bootstrap = sandbox.workspace === "read-only" || secret.claudeLogin;
    if (secret.claudeLogin && project.verify)
      this.store.put("turn", id, {
        ...this.store.get("turn", id)!,
        check: {
          container: `${turn.container}-check`,
          command: project.verify,
          image,
        },
      });
    if (sandbox.network === "provider-only")
      await createProviderNetwork(
        task.id,
        id,
        task.provider,
        image,
        secret.gateway?.baseUrl,
      );
    await checked([
      "docker",
      "create",
      "--name",
      turn.container,
      "--label",
      "dev.nerilo.managed=true",
      "--label",
      `dev.nerilo.task=${task.id}`,
      "--label",
      `dev.nerilo.turn=${id}`,
      "--interactive",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      ...sandboxLimits(sandbox),
      ...(sandbox.network === "provider-only" ? providerNetworkArgs(id) : []),
      "--tmpfs",
      "/tmp:rw,nosuid,size=1073741824",
      "--mount",
      `type=volume,source=nerilo-work-${task.id},target=/work${sandbox.workspace === "read-only" ? ",readonly" : ""}`,
      "--mount",
      `type=volume,source=nerilo-home-${task.id},target=/home/node`,
      ...(secret.claudeLogin ? await claudeLoginMounts(task.id) : []),
      image,
    ]);
    if (bootstrap)
      await prepareReadOnlyWorkspace({
        container: turn.container,
        taskId: task.id,
        turnId: id,
        image,
        sandbox,
      });
    if (!task.baseCommit) {
      const temp = join(dataDir, "bootstrap", id);
      await mkdir(temp, { recursive: true, mode: 0o700 });
      try {
        const startingHead =
          task.source?.headCommit ??
          (project.repository
            ? (task.remoteRevision ??
              (
                await readRemoteProject(
                  project.repository,
                  undefined,
                  project.branch,
                )
              ).headCommit)
            : null) ??
          (await checked(["git", "-C", project.path, "rev-parse", "HEAD"]));
        let head = startingHead;
        if (project.repository && !task.source && !task.remoteRevision)
          this.store.put("task", task.id, {
            ...this.store.get("task", task.id)!,
            remoteRevision: startingHead,
          });
        if (task.source) {
          this.log(
            task.id,
            id,
            "system",
            `Opening PR #${task.source.number} at ${head.slice(0, 8)}.`,
          );
          try {
            await bundleRevision(
              `https://github.com/${task.source.repository}.git`,
              task.source,
              temp,
            );
          } catch {
            throw new Error(
              "Could not fetch the PR's saved revisions. Check GitHub access and retry, or start a new task if those revisions are no longer available.",
            );
          }
        } else if (project.repository) {
          if (task.includeChanges)
            throw new Error(
              "GitHub tasks cannot include local working changes.",
            );
          await bundleRevision(
            `https://github.com/${project.repository}.git`,
            { headCommit: startingHead, baseCommit: startingHead },
            temp,
          );
        } else if (task.includeChanges) {
          head = await bundleWorkingChanges(
            project.path,
            temp,
            startingHead,
            task.includeUntracked,
          );
        } else
          await checked([
            "git",
            "-C",
            project.path,
            "bundle",
            "create",
            join(temp, "source.bundle"),
            "HEAD",
          ]);
        await checked([
          "docker",
          "cp",
          join(temp, "source.bundle"),
          `${turn.container}${bootstrap ? "-bootstrap" : ""}:/work/source.bundle`,
        ]);
        if (
          !task.source &&
          !project.repository &&
          (await checked(["git", "-C", project.path, "rev-parse", "HEAD"])) !==
            startingHead
        )
          throw new Error(
            "The project revision changed during preparation. Retry the task.",
          );
        await mkdir(join(dataDir, "snapshots"), {
          recursive: true,
          mode: 0o700,
        });
        await copyFile(
          join(temp, "source.bundle"),
          join(dataDir, "snapshots", `${task.id}.bundle`),
        );
        const fresh = this.store.get("task", task.id)!;
        this.store.put("task", task.id, { ...fresh, baseCommit: head });
      } catch (error) {
        if (bootstrap)
          await command([
            "docker",
            "rm",
            "-f",
            `${turn.container}-bootstrap`,
          ]).catch(() => {});
        throw error;
      } finally {
        await rm(temp, { recursive: true, force: true });
      }
    }
    if (bootstrap) {
      const output = await bootstrapReadOnly(
        turn.container,
        {
          branch: `nerilo/${task.id.slice(0, 8)}`,
          setup: task.baseCommit ? "" : project.setup,
          // Runs until setup succeeds once, e.g. after a failed first turn.
          retrySetup: project.setup,
        },
        () => Boolean(this.store.get("task", task.id)?.stopRequested),
      );
      if (output.trim()) this.log(task.id, id, "activity", output);
    }
    if (this.store.get("task", task.id)?.stopRequested) {
      await command(["docker", "rm", "-f", turn.container]);
      this.finishStopped(task.id);
      return;
    }
    const preset = this.store.get("preset", task.presetId);
    const notes = this.store
      .all("note")
      .filter((n) => n.projectId === null || n.projectId === task.projectId)
      .map((n) => `## ${n.title}\n${n.content}`)
      .join("\n\n");
    const current = this.store.get("task", task.id)!;
    // A failed launch may not have reached the provider. Resume from the
    // settings of the turn that actually supplied this session.
    const sessionTurn = this.store
      .all("turn")
      .findLast(
        (value) =>
          value.taskId === task.id &&
          value.id !== turn.id &&
          (value.result?.sessionId ?? value.sessionId) === task.sessionId,
      );
    const resume =
      task.sessionId &&
      sessionTurn &&
      (sessionTurn.execution?.provider ??
        task.sessionProvider ??
        task.provider) === task.provider &&
      (sessionTurn.connectionId ?? "direct") === connectionId &&
      !(sessionTurn.execution?.model && !task.model) &&
      !(sessionTurn.execution?.effort && !task.effort);
    const history = !resume
      ? this.store
          .all("turn")
          .filter((value) => value.taskId === task.id && value.id !== turn.id)
          .map(
            (value) =>
              `User: ${value.prompt}\nAssistant: ${value.result?.summary ?? "Turn interrupted or unfinished."}`,
          )
          .join("\n\n")
          .slice(-60000)
      : "";
    const payload = {
      ...secret,
      mcpServers,
      skills,
      readOnly: sandbox.workspace === "read-only",
      provider: task.provider,
      model: task.model,
      effort: task.effort,
      sessionId: resume ? task.sessionId : null,
      baseCommit: current.baseCommit,
      branch: `nerilo/${task.id.slice(0, 8)}`,
      setup: bootstrap || task.baseCommit ? "" : project.setup,
      retrySetup: bootstrap ? "" : project.setup,
      verify: secret.claudeLogin ? "" : project.verify,
      prompt: `${preset?.instructions ?? ""}\n\n${history ? `Earlier task conversation (may be truncated). The existing workspace is retained:\n${history}\n\n` : ""}${task.source ? `Workspace source: ${task.source.url} at ${task.source.headCommit}. PR comparison: git diff ${task.source.baseCommit}...${task.source.headCommit}. These revisions are pinned for this task; linked PR status may reflect newer pushes.\n\n` : ""}${notes ? `Project reference notes:\n${notes}\n\n` : ""}User request:\n${input.text}`,
      fixture: this.fixture,
      fixtureDelay: this.fixture ? 2000 : undefined,
    };
    await checked(["docker", "start", turn.container]);
    const attach = Bun.spawn(
      ["docker", "attach", "--sig-proxy=false", turn.container],
      { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
    );
    attach.stdin.write(JSON.stringify(payload) + "\n");
    attach.stdin.end();
    void attach.exited;
    this.store.put("turn", id, {
      ...this.store.get("turn", id)!,
      status: "running",
    });
  }
  private async reconcile(task: Task) {
    const turn = this.store.get("turn", task.activeTurnId!);
    if (!turn) {
      this.fail(task.id, "The execution record is missing.");
      return;
    }
    const inspect = await command(
      ["docker", "inspect", "--format", "{{json .State}}", turn.container],
      { timeout: 4000 },
    ).catch(() => null);
    if (!inspect || inspect.code !== 0) {
      // Only a missing container is conclusive. A slow or erroring Docker
      // retries, so a running agent is never orphaned by a failed task.
      if (
        inspect &&
        /no such (object|container)/i.test(inspect.stderr) &&
        (await this.runtime()).docker
      )
        this.fail(
          task.id,
          "The task container is unavailable. Work may still be retained in its volume. Retry to continue.",
        );
      return;
    }
    const state = z
      .object({
        Status: z.string(),
        Running: z.boolean(),
        ExitCode: z.number(),
      })
      .parse(JSON.parse(inspect.stdout));
    if (task.stopRequested) {
      if (turn.check)
        await command(["docker", "stop", "--time", "5", turn.check.container], {
          timeout: 10000,
        });
      await command(["docker", "stop", "--time", "5", turn.container], {
        timeout: 10000,
      });
      // Reinspect on the next tick before releasing the workspace.
      if (state.Running) return;
    }
    const logs = await command(["docker", "logs", turn.container], {
      timeout: 8000,
    }).catch(() => null);
    if (logs?.code === 0) {
      const lines = logs.stdout.trim().split("\n").filter(Boolean);
      this.store.transaction(() => {
        let cursor = turn.cursor;
        for (; cursor < lines.length; cursor++) {
          try {
            const e = runnerEvent.parse(JSON.parse(lines[cursor]));
            // The runner still owns its files and credentials until it exits.
            if (state.Running && (e.type === "result" || e.type === "fatal"))
              break;
            this.consume(task.id, turn.id, e);
          } catch {
            this.log(
              task.id,
              turn.id,
              "error",
              "An agent event could not be decoded.",
            );
          }
        }
        const fresh = this.store.get("turn", turn.id)!;
        this.store.put("turn", turn.id, { ...fresh, cursor });
      });
    }
    const fresh = this.store.get("task", task.id)!;
    if (!fresh.activeTurnId) return;
    if (fresh.stopRequested && !state.Running) {
      this.finishStopped(task.id);
      return;
    }
    // Unread logs may still hold the result; retry rather than report it lost.
    if (logs?.code !== 0) return;
    const currentTurn = this.store.get("turn", turn.id)!;
    if (
      currentTurn.check &&
      currentTurn.result?.exitCode === 0 &&
      !currentTurn.result.verification
    ) {
      if (state.Running) return;
      try {
        const result = await reconcileVerification(currentTurn);
        if (result) {
          this.log(
            task.id,
            turn.id,
            "activity",
            "Project verification finished.",
          );
          this.store.event({
            taskId: task.id,
            turnId: turn.id,
            kind: "check",
            text: `${result.verification?.command}\n${result.verification?.output ?? ""}`,
          });
          this.consume(task.id, turn.id, {
            type: "result",
            result: { ...currentTurn.result, ...result },
          });
        }
      } catch (error) {
        this.fail(
          task.id,
          error instanceof Error
            ? error.message
            : "Verification could not run.",
        );
      }
      return;
    }
    if (!state.Running)
      await command(["docker", "rm", "-f", `${turn.container}-bootstrap`], {
        timeout: 5000,
      }).catch(() => {});
    if (!state.Running)
      this.fail(
        task.id,
        state.Status === "created"
          ? "Preparation was interrupted. Retry to continue."
          : `The agent stopped without a result (exit ${state.ExitCode}). Retry to continue from retained work.`,
      );
  }
  private consume(
    taskId: string,
    turnId: string,
    e: z.infer<typeof runnerEvent>,
  ) {
    const task = this.store.get("task", taskId)!;
    if (e.type === "session" && e.id) {
      const turn = this.store.get("turn", turnId)!;
      const sessionId = e.id;
      this.store.transaction(() => {
        this.store.put("turn", turnId, { ...turn, sessionId });
        this.store.put("task", taskId, {
          ...task,
          sessionId,
          sessionProvider: turn.execution?.provider ?? task.provider,
        });
      });
    } else if (e.type === "base" && e.commit)
      this.store.put("task", taskId, { ...task, baseCommit: e.commit });
    else if (
      e.type === "phase" &&
      ["preparing", "working", "checking"].includes(e.phase ?? "")
    ) {
      this.store.put("task", taskId, {
        ...task,
        status: e.phase as "preparing" | "working" | "checking",
        updatedAt: now(),
      });
      this.log(taskId, turnId, "activity", e.text ?? e.phase!);
    } else if (
      ["assistant", "activity", "check", "error"].includes(e.type) &&
      e.text
    )
      this.store.event({
        taskId,
        turnId,
        kind: e.type as "assistant" | "activity" | "check" | "error",
        text: e.text,
      });
    else if (e.type === "fatal")
      this.fail(taskId, e.text ?? "Execution failed.");
    else if (e.type === "result" && e.result) {
      const result = e.result;
      const currentTurn = this.store.get("turn", turnId)!;
      if (currentTurn.check && result.exitCode === 0 && !result.verification) {
        this.store.put("turn", turnId, { ...currentTurn, result });
        this.store.put("task", taskId, {
          ...task,
          status: "checking",
          updatedAt: now(),
        });
        this.log(
          taskId,
          turnId,
          "activity",
          `Running ${currentTurn.check.command}`,
        );
        return;
      }
      const failed = result.exitCode !== 0;
      const checkFailed = Boolean(result.verification?.exitCode);
      this.store.put("turn", turnId, {
        ...this.store.get("turn", turnId)!,
        status: failed ? "failed" : "finished",
        endedAt: now(),
        result,
      });
      this.store.put("task", taskId, {
        ...task,
        sessionId: result.sessionId ?? task.sessionId,
        sessionProvider: result.sessionId
          ? (this.store.get("turn", turnId)?.execution?.provider ??
            task.provider)
          : task.sessionProvider,
        activeTurnId: null,
        stopRequested: false,
        status: task.stopRequested
          ? "paused"
          : failed
            ? "failed"
            : task.pending.length
              ? "queued"
              : checkFailed
                ? "check_failed"
                : "ready",
        error: failed
          ? "The agent could not finish. See the activity for details."
          : null,
        updatedAt: now(),
      });
      this.log(
        taskId,
        turnId,
        "system",
        failed
          ? "The agent could not finish."
          : checkFailed
            ? "Agent finished. The project check failed."
            : "Work is ready for review.",
      );
      if (!failed) void this.summarize(taskId).catch(() => {});
      void refreshStateSummary(this.store, taskId, {
        force: true,
        fixture: this.fixture,
      });
      if (currentTurn.sandbox?.network === "provider-only")
        void cleanupProviderNetwork(turnId).catch(() => {});
    }
  }
  private async launchFailed(taskId: string, error: unknown) {
    const task = this.store.get("task", taskId);
    const turn = task?.activeTurnId
      ? this.store.get("turn", task.activeTurnId)
      : null;
    // Nothing reconciles a turn container once the launch is abandoned.
    if (turn)
      await command(["docker", "rm", "-f", turn.container], {
        timeout: 10000,
      }).catch(() => {});
    // Pausing during preparation removes the bootstrap container, which
    // surfaces here as a launch error.
    if (turn && this.store.get("task", taskId)?.stopRequested)
      this.finishStopped(taskId);
    else this.fail(taskId, String(error));
  }
  fail(taskId: string, message: string) {
    const task = this.store.get("task", taskId);
    if (!task) return;
    if (task.activeTurnId) {
      const turn = this.store.get("turn", task.activeTurnId);
      if (turn?.sandbox?.network === "provider-only")
        void cleanupProviderNetwork(turn.id).catch(() => {});
      if (turn)
        this.store.put("turn", turn.id, {
          ...turn,
          status: "failed",
          endedAt: now(),
        });
    }
    this.store.put("task", taskId, {
      ...task,
      status: "failed",
      activeTurnId: null,
      error: message.slice(0, 4000),
      updatedAt: now(),
    });
    this.log(taskId, task.activeTurnId, "error", message);
    void refreshStateSummary(this.store, taskId, {
      force: true,
      fixture: this.fixture,
    });
  }
  private finishStopped(taskId: string) {
    const task = this.store.get("task", taskId)!;
    if (task.activeTurnId) {
      const turn = this.store.get("turn", task.activeTurnId)!;
      if (turn.sandbox?.network === "provider-only")
        void cleanupProviderNetwork(turn.id).catch(() => {});
      this.store.put("turn", turn.id, {
        ...turn,
        status: "paused",
        endedAt: now(),
      });
    }
    this.store.put("task", taskId, {
      ...task,
      status: "paused",
      activeTurnId: null,
      stopRequested: false,
      updatedAt: now(),
    });
    this.log(
      taskId,
      null,
      "system",
      "Paused. The workspace and conversation are retained.",
    );
    void refreshStateSummary(this.store, taskId, {
      force: true,
      fixture: this.fixture,
    });
  }
  async checkout(
    task: Task,
    project: Project,
    turnId: string,
  ): Promise<NonNullable<Task["checkout"]>> {
    task = this.store.get("task", task.id)!;
    if (task.activeTurnId || activeStatuses.includes(task.status))
      throw new Error("Wait for the task to stop before creating a checkout.");
    const latest = this.store
      .all("turn")
      .filter((turn) => turn.taskId === task.id)
      .at(-1);
    if (latest?.id !== turnId || !latest.result)
      throw new Error("The result changed. Review the latest turn.");
    if (latest.result.truncated)
      throw new Error(
        "The patch is incomplete. A checkout cannot be created from this result.",
      );
    const parent = join(dataDir, "checkouts");
    await mkdir(parent, { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(parent, `${task.id.slice(0, 8)}-`));
    const path = join(directory, "repo");
    try {
      const base = latest.result.baseCommit;
      const saved = join(dataDir, "snapshots", `${task.id}.bundle`);
      if (await lstat(saved).catch(() => null)) {
        await copyFile(saved, join(directory, "source.bundle"));
      } else
        await bundleRevision(
          task.source
            ? `https://github.com/${task.source.repository}.git`
            : project.repository
              ? `https://github.com/${project.repository}.git`
              : project.path,
          { headCommit: base, baseCommit: task.source?.baseCommit ?? base },
          directory,
        );
      await checked([
        "git",
        "clone",
        "--",
        join(directory, "source.bundle"),
        path,
      ]);
      await checked(["git", "-C", path, "remote", "remove", "origin"]);
      const git = ["git", "-C", path];
      const head = latest.result.headCommit;
      if (!/^[a-f0-9]{40}$/.test(head))
        throw new Error(
          "The result revision is invalid. Run the task again before exporting.",
        );
      if (
        (await command([...git, "cat-file", "-e", `${head}^{commit}`])).code
      ) {
        const history = await bundleWorkspaceHistory(task.id, head, directory);
        await checked([...git, "fetch", history, "HEAD"]);
        if ((await checked([...git, "rev-parse", "FETCH_HEAD"])) !== head)
          throw new Error(
            "The exported workspace revision changed. Review the latest result.",
          );
      }
      const imported = task.source;
      const linked = task.pullRequests.find((pr) => pr.url === imported?.url);
      const branch =
        imported?.headBranch ?? linked?.head ?? `nerilo/${task.id.slice(0, 8)}`;
      await validateBranch(branch);
      await checked(["git", "-C", path, "checkout", "-B", branch, base]);
      if (latest.result.diff)
        await checked(
          ["git", "-C", path, "apply", "--binary", "--index", "-"],
          {
            input: latest.result.diff,
          },
        );
      // Keep the reviewed tree but retain agent-created commits, including merges.
      // Resetting to the original base here silently discarded base integrations.
      await checked([...git, "reset", "--soft", head]);
      await checked([...git, "reset", "--mixed", head]);
      await rm(join(directory, "source.git"), { recursive: true, force: true });
      await rm(join(directory, "source.bundle"), { force: true });
      await rm(join(directory, "result.bundle"), { force: true });
      const current = this.store.get("task", task.id)!;
      if (
        current.activeTurnId ||
        current.pending.length ||
        this.store
          .all("turn")
          .filter((turn) => turn.taskId === task.id)
          .at(-1)?.id !== turnId
      )
        throw new Error(
          "The task changed. Review its latest result before exporting.",
        );
      const checkout = {
        path,
        turnId,
        createdAt: now(),
        pullRequest:
          imported && (imported.headBranch || linked)
            ? {
                url: imported.url,
                number: imported.number,
                repository: imported.repository,
                branch,
                expectedHead: imported.headCommit,
              }
            : null,
      };
      this.store.put("task", task.id, {
        ...this.store.get("task", task.id)!,
        checkout,
      });
      this.log(
        task.id,
        turnId,
        "system",
        `Created a local checkout at ${path}.`,
      );
      return checkout;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  async apply(task: Task, project: Project, turnId: string) {
    if (!project.path)
      throw new Error(
        "This GitHub project has no local folder. Use its task checkout to commit and publish changes.",
      );
    if (task.activeTurnId || activeStatuses.includes(task.status))
      throw new Error("Wait for the task to stop before applying changes.");
    const turns = this.store.all("turn").filter((t) => t.taskId === task.id);
    const latest = turns.at(-1);
    if (latest?.id !== turnId || !latest.result)
      throw new Error("The result changed. Review the latest turn.");
    if (latest.result.truncated)
      throw new Error(
        "This patch is too large for safe application from the app.",
      );
    if (await checked(["git", "-C", project.path, "status", "--porcelain"]))
      throw new Error(
        "The project has local changes. Commit or stash them before applying this patch.",
      );
    if (
      (await checked(["git", "-C", project.path, "rev-parse", "HEAD"])) !==
      task.baseCommit
    )
      throw new Error(
        "The project revision has changed. Export and review the patch manually.",
      );
    if (!latest.result.diff)
      throw new Error("This task has no patch to apply.");
    await checked(["git", "-C", project.path, "apply", "--check", "-"], {
      input: latest.result.diff,
    });
    await checked(["git", "-C", project.path, "apply", "-"], {
      input: latest.result.diff,
    });
    this.log(
      task.id,
      turnId,
      "system",
      "Applied the reviewed patch to the local project. No commit or push was made.",
    );
  }
  async files(task: Task) {
    return listWorkspaceFiles(task.id);
  }
  async file(task: Task, path: string) {
    return readWorkspaceFile(task.id, path);
  }
}
