import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import {
  readRequestText,
  RequestTooLargeError,
  executionSchema,
  taskInput,
  projectInput,
  presetInput,
  noteInput,
  providerSchema,
  settingsSchema,
  ordered,
  reorder,
  gitActionSchema,
  sandboxSchema,
  reviewRequestOriginSchema,
  type Task,
} from "@nerilo/protocol";
import { modelCatalog, validateExecution } from "./models";
import { Store } from "./store";
import { saveMcpServers } from "./mcp";
import { saveAgentSkills } from "./skills";
import { discoverGithubSkills, importGithubSkill } from "./skill-sources";
import { saveTaskAgentTools, validateAgentTools } from "./agent-tools";
import { SKILLS_REQUEST_LIMIT } from "@nerilo/protocol";
import { Engine } from "./engine";
import { dataDir, now } from "./config";
import { readMachineIdentity } from "./machine-identity";
import {
  saveKey,
  importCodex,
  importClaude,
  disconnect,
  selectClaudeLogin,
  selectGateway,
} from "./credentials";
import { gatewayView, saveGateway, importedGateway } from "./gateway";
import { handleClaudeLogin } from "./claude-login";
import { isTaskLocked, withTaskLock } from "./task-locks";
import {
  archiveProject,
  deleteProject,
  isProjectDeleting,
  requireAvailableProject,
} from "./project-lifecycle";
import { gitStatus, gitRemoteStatus, gitAction } from "./git-workflows";
import { generateGitDraft, testConnection } from "./ai-suggestions";
import { readStateSummary } from "./state-summary";
import { readRemoteProject } from "./remote-projects";
import { deleteTask } from "./task-delete";
import { autonomyStatus, configureAutonomy } from "./autonomy";
import {
  queueActionSchema,
  updateQueue,
  validateSchedule,
} from "./queue-actions";

import {
  githubPullRequestURL,
  readPullRequest,
  listProjectPullRequests,
  readPullRequestSource,
} from "./pull-requests";

const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function authorized(value: string | null, secret: string) {
  const candidate = Buffer.from(value ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return (
    candidate.length === expected.length && timingSafeEqual(candidate, expected)
  );
}
export function createApi(store: Store, engine: Engine, secret: string) {
  const schedule = () => {
    void engine
      .tick()
      .catch((error) =>
        console.error(
          "Scheduler:",
          error instanceof Error ? error.message : String(error),
        ),
      );
  };
  const requireTask = (id: string) => {
    const task = store.get("task", id);
    if (!task) throw new Error("Task not found.");
    return task;
  };
  const requireUniqueProject = (
    validated: { path: string; repository: string | null },
    excluding?: string,
  ) => {
    const duplicate = store
      .all("project")
      .find(
        (p) =>
          p.id !== excluding &&
          (validated.repository
            ? p.repository?.toLowerCase() === validated.repository.toLowerCase()
            : p.path === validated.path),
      );
    if (duplicate)
      throw new Error(
        duplicate.archived
          ? "This project is archived. Restore it from Projects → Archived."
          : "This project is already added.",
      );
  };
  return async (request: Request): Promise<Response> => {
    if (!authorized(request.headers.get("authorization"), secret))
      return json({ error: "Unauthorized" }, 401);
    const login = await handleClaudeLogin(request, selectClaudeLogin);
    if (login) return login;
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (request.method === "GET") {
        const gateway = /^\/connections\/(codex|claude)\/gateway$/.exec(path);
        if (gateway) return json(gatewayView(providerSchema.parse(gateway[1])));
        if (path === "/machine") return json(readMachineIdentity(dataDir));
        const stateSummary = path.match(/^\/tasks\/([^/]+)\/state-summary$/);
        if (stateSummary) return json(readStateSummary(store, stateSummary[1]));
        const autonomy = path.match(/^\/tasks\/([^/]+)\/autonomy$/);
        if (autonomy) return json(autonomyStatus(store, autonomy[1]));
        if (path === "/models") return json(await modelCatalog(store));
        const git = path.match(/^\/tasks\/([^/]+)\/git$/);
        if (git) return json(await gitStatus(store, git[1]));
        const gitRemote = path.match(/^\/tasks\/([^/]+)\/git\/remote$/);
        if (gitRemote) return json(await gitRemoteStatus(store, gitRemote[1]));
        const projectPRs = path.match(/^\/projects\/([^/]+)\/pull-requests$/);
        if (projectPRs) {
          const project = store.get("project", projectPRs[1]);
          if (!project) throw new Error("Project not found.");
          return json(await listProjectPullRequests(project));
        }
        const files = path.match(/^\/tasks\/([^/]+)\/files$/);
        if (files) return json(await engine.files(requireTask(files[1])));
        const file = path.match(/^\/tasks\/([^/]+)\/file$/);
        if (file)
          return json(
            await engine.file(
              requireTask(file[1]),
              url.searchParams.get("path") ?? "",
            ),
          );
        if (path === "/snapshot")
          return json({
            projects: store.all("project"),
            tasks: store
              .all("task")
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
            presets: store.all("preset"),
            notes: store.all("note"),
            settings: store.get("settings", "default"),
            runtime: await engine.runtime(),
            sequence: store.sequence(),
          });
        if (path === "/events") {
          let cursor = Number(url.searchParams.get("after") ?? 0);
          let timer: ReturnType<typeof setInterval> | undefined;
          let close = () => {};
          const stream = new ReadableStream({
            start(controller) {
              if (request.signal.aborted) {
                controller.close();
                return;
              }
              const send = () => {
                if ((controller.desiredSize ?? 0) <= 0) return;
                const next = store.sequence();
                controller.enqueue(
                  new TextEncoder().encode(
                    next !== cursor
                      ? `id: ${next}\nevent: change\ndata: ${next}\n\n`
                      : ": heartbeat\n\n",
                  ),
                );
                cursor = next;
              };
              send();
              timer = setInterval(send, 1500);
              close = () => {
                clearInterval(timer);
                request.signal.removeEventListener("abort", close);
                try {
                  controller.close();
                } catch {}
              };
              request.signal.addEventListener("abort", close, { once: true });
            },
            cancel() {
              clearInterval(timer);
              request.signal.removeEventListener("abort", close);
            },
          });
          return new Response(stream, {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "X-Accel-Buffering": "no",
            },
          });
        }
        const match = path.match(/^\/tasks\/([^/]+)(\/patch)?$/);
        if (match) {
          const task = requireTask(match[1]);
          const turns = store.all("turn").filter((t) => t.taskId === task.id);
          if (match[2]) {
            const result = turns.at(-1)?.result;
            if (!result) throw new Error("No patch is available.");
            if (result.truncated)
              throw new Error("The patch exceeds the export limit.");
            return new Response(result.diff, {
              headers: {
                "Content-Type": "text/plain; charset=utf-8",
                "Content-Disposition": `attachment; filename="nerilo-${task.id.slice(0, 8)}.patch"`,
              },
            });
          }
          return json({ task, turns, events: store.events(task.id) });
        }
        return json({ error: "Not found" }, 404);
      }
      if (request.method !== "POST")
        return json({ error: "Method not allowed" }, 405);
      const bodyLimit = path === "/skills" ? SKILLS_REQUEST_LIMIT : 100000;
      const raw = await readRequestText(request, bodyLimit);
      const body: unknown = raw ? JSON.parse(raw) : {};
      const projectAction = path.match(
        /^\/projects\/([^/]+)\/(archive|delete)$/,
      );
      if (projectAction) {
        if (projectAction[2] === "delete")
          return json(await deleteProject(store, projectAction[1]));
        return json(
          archiveProject(
            store,
            projectAction[1],
            z.object({ archived: z.boolean() }).parse(body).archived,
          ),
        );
      }
      const taskMutation = path.match(/^\/tasks\/([^/]+)\/(.+)$/);
      if (taskMutation) {
        const task = requireTask(taskMutation[1]);
        if (isProjectDeleting(task.projectId))
          throw new Error("This project is being deleted. Try again shortly.");
        const operation = taskMutation[2];
        const allowed =
          ["delete", "pause", "archive", "cancel-input", "checkout"].includes(
            operation,
          ) ||
          (operation === "autonomy" &&
            z.object({ mode: z.string().optional() }).parse(body).mode ===
              "off") ||
          (operation === "queue" &&
            z.object({ action: z.string().optional() }).parse(body).action ===
              "remove");
        if (!allowed) requireAvailableProject(store, task.projectId);
      }
      const autonomy = path.match(/^\/tasks\/([^/]+)\/autonomy$/);
      if (autonomy) {
        if (isTaskLocked(autonomy[1]))
          throw new Error(
            "This task is finishing a Git action. Try again shortly.",
          );
        return json(
          await withTaskLock(autonomy[1], () =>
            configureAutonomy(store, autonomy[1], body),
          ),
        );
      }
      const lockedTask = path.match(/^\/tasks\/([^/]+)\//);
      if (
        lockedTask &&
        !path.endsWith("/autonomy") &&
        isTaskLocked(lockedTask[1])
      )
        throw new Error(
          "This task is finishing a Git action. Try again shortly.",
        );
      if (path === "/sandbox-defaults") {
        const settings = store.get("settings", "default")!;
        const sandbox = sandboxSchema.parse(body);
        store.put("settings", "default", { ...settings, sandbox });
        return json(sandbox);
      }
      if (path === "/skills/discover")
        return json(await discoverGithubSkills(body));
      if (path === "/skills/import") return json(await importGithubSkill(body));
      if (path === "/skills") {
        const { skills } = z.object({ skills: z.unknown() }).parse(body);
        return json(saveAgentSkills(store, skills));
      }
      if (path === "/mcp-servers") {
        const { servers } = z.object({ servers: z.unknown() }).parse(body);
        return json(saveMcpServers(store, servers));
      }
      const sandboxAction = path.match(/^\/tasks\/([^/]+)\/sandbox$/);
      if (sandboxAction) {
        const task = requireTask(sandboxAction[1]);
        const { sandbox } = z
          .object({ sandbox: sandboxSchema.nullable() })
          .parse(body);
        store.put("task", task.id, { ...task, sandbox });
        store.event({
          taskId: task.id,
          turnId: null,
          kind: "system",
          text: `Sandbox settings updated${task.activeTurnId ? " for the next turn" : ""}.`,
        });
        return json({ ...task, sandbox });
      }
      const deletion = path.match(/^\/tasks\/([^/]+)\/delete$/);
      if (deletion)
        return json(
          await withTaskLock(deletion[1], () => deleteTask(store, deletion[1])),
        );
      const queue = path.match(/^\/tasks\/([^/]+)\/queue$/);
      if (queue) {
        const action = queueActionSchema.parse(body);
        const key = z
          .string()
          .uuid()
          .nullable()
          .parse(request.headers.get("idempotency-key"));
        return json(
          key
            ? store.command(`queue:${queue[1]}:${key}`, () =>
                updateQueue(store, queue[1], action),
              )
            : updateQueue(store, queue[1], action),
        );
      }
      if (path === "/projects") {
        const input = projectInput.parse(body);
        if (!input.path && !input.repository)
          throw new Error("Choose a GitHub repository or a local folder.");
        if (input.repository && input.path)
          throw new Error("Choose a GitHub repository or a local folder.");
        const validated = input.repository
          ? await readRemoteProject(input.repository, undefined, input.branch)
          : { ...(await engine.validateProject(input.path)), repository: null };
        requireUniqueProject(validated);
        const project = {
          ...input,
          ...validated,
          id: crypto.randomUUID(),
          createdAt: now(),
          archived: false,
        };
        store.put("project", project.id, project);
        return json(project, 201);
      }
      if (path === "/tasks") {
        const input = taskInput.parse(body);
        const project = requireAvailableProject(store, input.projectId);
        const preset = store.get("preset", input.presetId);
        if (!preset) throw new Error("Choose an agent.");
        const key = z
          .string()
          .uuid()
          .parse(request.headers.get("idempotency-key"));
        const replay = store.commandResult(`task:create:${key}`);
        if (replay !== null) return json(replay, 201);
        if (input.includeUntracked && !input.includeChanges)
          throw new Error("Include local changes before including new files.");
        if (project.repository && input.includeChanges)
          throw new Error(
            "GitHub projects start from committed files. Local changes are only available for local projects.",
          );
        if (input.pullRequestURL && input.includeChanges)
          throw new Error(
            "Local changes cannot be included when starting from a pull request.",
          );
        if (input.execution) await validateExecution(input.execution);
        const pullRequest = input.pullRequestURL
          ? await readPullRequestSource(input.pullRequestURL, project)
          : null;
        const remoteRevision =
          project.repository && !pullRequest
            ? (
                await readRemoteProject(
                  project.repository,
                  undefined,
                  project.branch,
                )
              ).headCommit
            : null;
        const response = store.command(`task:create:${key}`, () => {
          requireAvailableProject(store, input.projectId);
          const tools = validateAgentTools(
            store.get("settings", "default")!,
            input.tools,
          );
          const id = crypto.randomUUID();
          const inputId = crypto.randomUUID();
          const task: Task = {
            tools,
            sandbox: null,
            remoteRevision,
            source: pullRequest?.source ?? null,
            pullRequests: pullRequest ? [pullRequest.pr] : [],
            id,
            projectId: input.projectId,
            title:
              input.title ||
              input.prompt.split(/\n|(?<=[.!?])\s/)[0].slice(0, 72),
            titleSource: input.title?.trim() ? "manual" : "prompt",
            provider: input.execution?.provider ?? preset.provider,
            effort: input.execution?.effort ?? "",
            sessionProvider: null,
            presetId: preset.id,
            model: input.execution?.model ?? input.model ?? preset.model,
            status: "queued",
            sessionId: null,
            baseCommit: null,
            includeChanges: input.includeChanges,
            includeUntracked: input.includeUntracked,
            checkout: null,
            pending: [
              {
                id: inputId,
                text: input.prompt,
                createdAt: now(),
                scheduledAt: null,
              },
            ],
            activeTurnId: null,
            createdAt: now(),
            updatedAt: now(),
            archived: false,
            error: null,
            stopRequested: false,
          };
          store.put("task", id, task);
          store.event({
            taskId: id,
            turnId: null,
            kind: "user",
            text: input.prompt,
          });
          return task;
        });
        schedule();
        return json(response, 201);
      }
      const toolsAction = path.match(/^\/tasks\/([^/]+)\/tools$/);
      if (toolsAction)
        return json(saveTaskAgentTools(store, toolsAction[1], body));
      const executionAction = path.match(/^\/tasks\/([^/]+)\/execution$/);
      const metadataAction = path.match(/^\/tasks\/([^/]+)\/metadata$/);
      if (metadataAction) {
        requireTask(metadataAction[1]);
        const suggestion = await engine.summarize(metadataAction[1], true);
        if (!suggestion)
          throw new Error(
            "A name could not be generated. Try again after the agent finishes.",
          );
        return json(suggestion);
      }
      const gitActionPath = path.match(/^\/tasks\/([^/]+)\/git(\/draft)?$/);
      if (gitActionPath) {
        return await withTaskLock(gitActionPath[1], async () => {
          if (gitActionPath[2]) {
            const task = requireTask(gitActionPath[1]);
            const status = await gitStatus(store, task.id);
            const latest = store
              .all("turn")
              .filter((turn) => turn.taskId === task.id)
              .at(-1);
            return json(
              await generateGitDraft(
                task.provider,
                task.model,
                `Task: ${task.title}\nAgent summary: ${latest?.result?.summary.slice(0, 12000) ?? ""}\nBranch: ${status.branch}\nChanged files:\n${status.files}\nDiff (may be truncated):\n${status.patch.slice(0, 24000)}`,
              ),
            );
          }
          return json(
            await gitAction(
              store,
              gitActionPath[1],
              gitActionSchema.parse(body),
            ),
          );
        });
      }
      if (executionAction) {
        const execution = executionSchema.parse(body);
        requireTask(executionAction[1]);
        await validateExecution(execution);
        const task = requireTask(executionAction[1]);
        requireAvailableProject(store, task.projectId);
        for (const turn of store
          .all("turn")
          .filter((turn) => turn.taskId === task.id && !turn.execution)) {
          store.put("turn", turn.id, {
            ...turn,
            execution: {
              provider: task.provider,
              model: task.model,
              effort: task.effort,
            },
          });
        }
        const next = {
          ...task,
          ...execution,
          sessionProvider:
            task.sessionProvider ?? (task.sessionId ? task.provider : null),
        };
        store.put("task", task.id, next);
        store.event({
          taskId: task.id,
          turnId: null,
          kind: "system",
          text: `${execution.provider === "codex" ? "Codex" : "Claude Code"} · ${execution.model || "Default model"} · ${execution.effort || "Default"} effort${task.activeTurnId ? " (next turn)" : ""}`,
        });
        return json(next);
      }
      const prAction = path.match(/^\/tasks\/([^/]+)\/pull-requests$/);
      if (prAction) {
        const { url, remove } = z
          .object({
            url: z.string().max(2000),
            remove: z.boolean().default(false),
          })
          .parse(body);
        const canonical = githubPullRequestURL(url);
        const original = requireTask(prAction[1]);
        if (
          !remove &&
          original.pullRequests.length >= 8 &&
          !original.pullRequests.some((pr) => pr.url === canonical)
        )
          throw new Error("A task can link up to 8 pull requests.");
        const pr = remove ? null : await readPullRequest(canonical);
        const task = requireTask(original.id);
        requireAvailableProject(store, task.projectId);
        const pullRequests = task.pullRequests.filter(
          (value) => value.url !== canonical,
        );
        if (pr && pullRequests.length >= 8)
          throw new Error("A task can link up to 8 pull requests.");
        if (pr) pullRequests.push(pr);
        store.put("task", task.id, { ...task, pullRequests });
        store.event({
          taskId: task.id,
          turnId: null,
          kind: "system",
          text: remove
            ? "Pull request unlinked."
            : `Pull request #${pr!.number} updated.`,
        });
        return json({ ok: true });
      }
      const action = path.match(
        /^\/tasks\/([^/]+)\/(follow-up|pause|retry|complete|archive|rename|apply|checkout|cancel-input)$/,
      );
      if (action) {
        let task = requireTask(action[1]);
        const name = action[2];
        if (name === "checkout") {
          const { turnId } = z.object({ turnId: z.string() }).parse(body);
          return json(
            await withTaskLock(task.id, () =>
              engine.checkout(
                task,
                store.get("project", task.projectId)!,
                turnId,
              ),
            ),
          );
        }
        if (name === "follow-up") {
          const { text, scheduledAt, requestOrigin } = z
            .object({
              text: z.string().trim().min(1).max(30000),
              requestOrigin: reviewRequestOriginSchema.optional(),
              scheduledAt: z
                .string()
                .datetime({ offset: true })
                .nullable()
                .default(null),
            })
            .parse(body);
          const key = z
            .string()
            .uuid()
            .parse(request.headers.get("idempotency-key"));
          const response = store.command(
            `task:${task.id}:follow-up:${key}`,
            () => {
              task = requireTask(task.id);
              requireAvailableProject(store, task.projectId);
              if (task.archived)
                throw new Error("Restore this task before continuing.");
              const next = {
                ...task,
                pending: [
                  ...task.pending,
                  {
                    id: crypto.randomUUID(),
                    text,
                    ...(requestOrigin ? { requestOrigin } : {}),
                    createdAt: now(),
                    scheduledAt: validateSchedule(scheduledAt),
                  },
                ],
                status: task.activeTurnId ? task.status : ("queued" as const),
                error: null,
                updatedAt: now(),
              };
              store.put("task", task.id, next);
              store.event({
                taskId: task.id,
                turnId: null,
                kind: "user",
                text,
              });
              return next;
            },
          );
          schedule();
          return json(response);
        }
        if (name === "apply") {
          const { turnId } = z.object({ turnId: z.string() }).parse(body);
          await withTaskLock(task.id, () =>
            engine.apply(task, store.get("project", task.projectId)!, turnId),
          );
          return json({ ok: true });
        }
        if (name === "pause") {
          task = {
            ...task,
            stopRequested: Boolean(task.activeTurnId),
            status: task.activeTurnId ? task.status : "paused",
          };
        }
        if (name === "retry") {
          if (task.archived)
            throw new Error("Restore this task before continuing.");
          if (task.activeTurnId) throw new Error("This task is still running.");
          const last = store
            .all("turn")
            .filter((t) => t.taskId === task.id)
            .at(-1);
          if (!task.pending.length) {
            if (!last) throw new Error("Add instructions to continue.");
            task.pending = [
              {
                id: crypto.randomUUID(),
                text: last.prompt,
                ...(last.requestOrigin
                  ? { requestOrigin: last.requestOrigin }
                  : {}),
                createdAt: now(),
                scheduledAt: null,
              },
            ];
          }
          task = {
            ...task,
            status: "queued",
            error: null,
            stopRequested: false,
          };
        }
        if (name === "complete") {
          if (task.activeTurnId || task.pending.length)
            throw new Error("Finish or cancel queued work first.");
          task = { ...task, status: "complete", error: null };
        }
        if (name === "archive") {
          if (task.activeTurnId)
            throw new Error("Pause the task before archiving it.");
          task = {
            ...task,
            archived: z.object({ archived: z.boolean() }).parse(body).archived,
          };
        }
        if (name === "rename")
          task = {
            ...task,
            titleSource: "manual",
            title: z
              .object({ title: z.string().trim().min(1).max(160) })
              .parse(body).title,
          };
        if (name === "cancel-input") {
          const { inputId } = z.object({ inputId: z.string() }).parse(body);
          task = {
            ...task,
            pending: task.pending.filter((i) => i.id !== inputId),
          };
          if (
            !task.activeTurnId &&
            !task.pending.length &&
            task.status === "queued"
          )
            task.status = "paused";
        }
        task.updatedAt = now();
        store.put("task", task.id, task);
        store.event({
          taskId: task.id,
          turnId: null,
          kind: "system",
          text: (
            {
              pause: "Pause requested.",
              retry: "Queued to continue.",
              complete: "Marked complete.",
              archive: task.archived ? "Archived." : "Restored.",
              rename: "Task renamed.",
              "cancel-input": "Queued follow-up removed.",
            } as Record<string, string>
          )[name],
        });
        schedule();
        return json(task);
      }
      if (path === "/sidebar-order") {
        const { kind, id, overId, edge } = z
          .object({
            kind: z.enum(["project", "task"]),
            id: z.string(),
            overId: z.string(),
            edge: z.enum(["before", "after"]),
          })
          .parse(body);
        const settings = store.get("settings", "default")!;
        const order = settings.sidebarOrder;
        if (kind === "project") {
          if (!store.get("project", id) || !store.get("project", overId))
            throw new Error("Project no longer exists.");
          order.projects = reorder(
            ordered(store.all("project"), order.projects).map((p) => p.id),
            id,
            overId,
            edge,
          );
        } else {
          const task = requireTask(id),
            target = requireTask(overId);
          if (task.projectId !== target.projectId)
            throw new Error("Reorder tasks within their project.");
          const tasks = store
            .all("task")
            .filter((t) => t.projectId === task.projectId)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
          order.tasks[task.projectId] = reorder(
            ordered(tasks, order.tasks[task.projectId] ?? []).map((t) => t.id),
            id,
            overId,
            edge,
          );
        }
        store.put("settings", "default", { ...settings, sidebarOrder: order });
        store.event({
          taskId: null,
          turnId: null,
          kind: "system",
          text: "Sidebar reordered.",
        });
        return json(order);
      }
      if (path === "/settings") {
        const previous = store.get("settings", "default")!;
        const settings = {
          ...settingsSchema.parse({
            ...previous,
            ...z.record(z.string(), z.unknown()).parse(body),
          }),
          sidebarOrder: previous.sidebarOrder,
          sandbox: previous.sandbox,
          mcpServers: previous.mcpServers,
          skills: previous.skills,
        };
        store.put("settings", "default", settings);
        return json(settings);
      }
      if (path === "/presets") {
        const preset = { ...presetInput.parse(body), id: crypto.randomUUID() };
        store.put("preset", preset.id, preset);
        return json(preset, 201);
      }
      if (path === "/notes") {
        const note = {
          ...noteInput.parse(body),
          id: crypto.randomUUID(),
          updatedAt: now(),
        };
        if (note.projectId) requireAvailableProject(store, note.projectId);
        store.put("note", note.id, note);
        return json(note, 201);
      }
      const edit = path.match(/^\/(projects|presets|notes)\/([^/]+)$/);
      if (edit) {
        const kind =
          edit[1] === "projects"
            ? "project"
            : edit[1] === "presets"
              ? "preset"
              : "note";
        const id = edit[2];
        const existing = store.get(kind, id);
        if (!existing) throw new Error("Not found.");
        if (z.object({ remove: z.boolean().optional() }).parse(body).remove) {
          if (kind === "project")
            throw new Error(
              "Use the project deletion action to remove this project and its retained data.",
            );
          if (
            kind === "preset" &&
            store.all("task").some((t) => t.presetId === id)
          )
            throw new Error(
              "This agent preset is used by retained tasks. Edit it instead.",
            );
          store.remove(kind, id);
          return json({ ok: true });
        }
        if (kind === "project") {
          requireAvailableProject(store, id);
          const input = projectInput.parse(body);
          if (!input.path && !input.repository)
            throw new Error("Choose a GitHub repository or a local folder.");
          if (input.repository && input.path)
            throw new Error("Choose a GitHub repository or a local folder.");
          const validated = input.repository
            ? await readRemoteProject(input.repository, undefined, input.branch)
            : {
                ...(await engine.validateProject(input.path)),
                repository: null,
              };
          const current = requireAvailableProject(store, id);
          requireUniqueProject(validated, id);
          if (
            (current.repository !== validated.repository ||
              current.path !== validated.path) &&
            store.all("task").some((task) => task.projectId === id)
          )
            throw new Error(
              "This project has retained tasks. Add the other repository as a new project.",
            );
          store.put("project", id, {
            ...store.get("project", id)!,
            ...input,
            ...validated,
          });
        }
        if (kind === "preset")
          store.put("preset", id, { id, ...presetInput.parse(body) });
        if (kind === "note") {
          const old = store.get("note", id)!;
          if (old.projectId) requireAvailableProject(store, old.projectId);
          const input = noteInput.parse(body);
          if (input.projectId) requireAvailableProject(store, input.projectId);
          store.put("note", id, {
            id,
            ...input,
            updatedAt: now(),
          });
        }
        return json(store.get(kind, id));
      }
      if (path === "/runtime/build") {
        void engine.build();
        return json({ ok: true });
      }
      if (path === "/connections") {
        const input = z
          .object({
            provider: providerSchema,
            action: z.enum(["key", "import", "disconnect"]),
            key: z.string().optional(),
          })
          .parse(body);
        if (input.action === "import") {
          if (input.provider === "codex") importCodex();
          else await importClaude();
        }
        if (input.action === "key")
          await saveKey(input.provider, z.string().min(1).parse(input.key));
        if (input.action === "disconnect") await disconnect(input.provider);
        return json(await engine.runtime(true));
      }
      const gateway =
        /^\/connections\/(codex|claude)\/(gateway|gateway-import|test)$/.exec(
          path,
        );
      if (gateway) {
        const provider = providerSchema.parse(gateway[1]);
        if (gateway[2] === "test") return json(await testConnection(provider));
        const view = saveGateway(
          provider,
          gateway[2] === "gateway-import" ? importedGateway(provider) : body,
        );
        selectGateway(provider);
        await engine.runtime(true);
        return json(view);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json(
        {
          error:
            error instanceof z.ZodError
              ? error.issues.map((i) => i.message).join(" ")
              : error instanceof Error
                ? error.message
                : "The request could not be completed.",
        },
        error instanceof RequestTooLargeError ? 413 : 400,
      );
    }
  };
}
