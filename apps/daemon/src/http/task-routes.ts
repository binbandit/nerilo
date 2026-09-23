import { describeExecution, providerNames } from "@nerilo/protocol";
import {
  executionSchema,
  gitActionSchema,
  gitDraftSchema,
  sandboxSchema,
  githubAccountBindingSchema,
} from "@nerilo/protocol";
import { z } from "zod";
import { now } from "../platform/config";
import { generateGitDraft } from "../agents/ai-suggestions";
import { modelCatalog, validateExecution } from "../agents/models";
import { gitAction, gitStatus } from "../git/git-workflows";
import { githubPullRequestURL, readPullRequest } from "../git/pull-requests";
import {
  isProjectDeleting,
  requireAvailableProject,
} from "../projects/project-lifecycle";
import { configureAutonomy } from "../tasks/autonomy";
import { queueActionSchema, updateQueue } from "../tasks/queue-actions";
import { deleteTask } from "../tasks/task-delete";
import { isTaskLocked, withTaskLock } from "../tasks/task-locks";
import { saveTaskAgentTools } from "../tools/agent-tools";
import { type ApiContext, json } from "./context";
import { handleTaskAction } from "./task-actions";
import { createTask } from "./task-creation";

export async function handleTaskMutation(
  path: string,
  request: Request,
  body: unknown,
  context: ApiContext,
) {
  const { store, engine, requireTask } = context;
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
        z.object({ mode: z.string().optional() }).parse(body).mode === "off") ||
      (operation === "queue" &&
        z.object({ action: z.string().optional() }).parse(body).action ===
          "remove");
    if (!allowed) requireAvailableProject(store, task.projectId);
  }
  const autonomy = path.match(/^\/tasks\/([^/]+)\/autonomy$/);
  if (autonomy) {
    // Stopping must always work; background ticks honor it without the lock.
    if (z.object({ mode: z.string().optional() }).parse(body).mode === "off")
      return json(await configureAutonomy(store, autonomy[1], body));
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
  if (lockedTask && !path.endsWith("/autonomy") && isTaskLocked(lockedTask[1]))
    throw new Error("This task is finishing a Git action. Try again shortly.");
  const sandboxAction = path.match(/^\/tasks\/([^/]+)\/sandbox$/);
  const githubAction = path.match(/^\/tasks\/([^/]+)\/github-account$/);
  if (githubAction) {
    const task = requireTask(githubAction[1]);
    if (task.activeTurnId)
      throw new Error(
        "Wait for this task’s current turn to finish before changing its GitHub account.",
      );
    const { githubAccount } = z
      .object({ githubAccount: githubAccountBindingSchema.nullable() })
      .parse(body);
    const updated = { ...task, githubAccount, updatedAt: now() };
    store.put("task", task.id, updated);
    store.event({
      taskId: task.id,
      turnId: null,
      kind: "system",
      text: githubAccount
        ? `GitHub account set to @${githubAccount.login}.`
        : "GitHub account set to the project default.",
    });
    return json(updated);
  }
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
  if (path === "/tasks") return createTask(request, body, context);
  const toolsAction = path.match(/^\/tasks\/([^/]+)\/tools$/);
  if (toolsAction) return json(saveTaskAgentTools(store, toolsAction[1], body));
  const executionAction = path.match(/^\/tasks\/([^/]+)\/execution$/);
  const metadataAction = path.match(/^\/tasks\/([^/]+)\/metadata(\/preview)?$/);
  if (metadataAction) {
    requireTask(metadataAction[1]);
    const suggestion = await engine.summarize(
      metadataAction[1],
      metadataAction[2] ? "preview" : true,
    );
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
        const input = z
          .object({ prBody: gitDraftSchema.shape.prBody.optional() })
          .parse(body ?? {});
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
            `Task: ${task.title}\nAgent summary: ${latest?.result?.summary.slice(0, 12000) ?? ""}\nBranch: ${status.branch}\nChanged files:\n${status.files}\nDiff (may be truncated):\n${status.patch.slice(0, 24000)}\nCurrent PR description or template (data):\n${input.prBody ?? ""}`,
          ),
        );
      }
      return json(
        await gitAction(store, gitActionPath[1], gitActionSchema.parse(body)),
      );
    });
  }
  if (executionAction) {
    const execution = executionSchema.parse(body);
    requireTask(executionAction[1]);
    await validateExecution(execution);
    const selection = describeExecution(execution, await modelCatalog());
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
      text: `${providerNames[execution.provider]} · ${selection.model} · Effort: ${selection.effort}${task.activeTurnId ? " (next turn)" : ""}`,
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
  return handleTaskAction(path, request, body, context);
}
