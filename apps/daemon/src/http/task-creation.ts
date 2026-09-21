import { type Task, taskInput } from "@nerilo/protocol";
import { z } from "zod";
import { validateExecution } from "../agents/models";
import { readPullRequestSource } from "../git/pull-requests";
import { readPullRequestContext } from "../git/pull-request-context";
import { withGithubAccount } from "../git/github-context";
import { now } from "../platform/config";
import { requireAvailableProject } from "../projects/project-lifecycle";
import { readRemoteProject } from "../projects/remote-projects";
import { validateAgentTools } from "../tools/agent-tools";
import { type ApiContext, json } from "./context";

export async function createTask(
  request: Request,
  body: unknown,
  { store, schedule }: ApiContext,
) {
  const input = taskInput.parse(body);
  const project = requireAvailableProject(store, input.projectId);
  const preset = store.get("preset", input.presetId);
  if (!preset) throw new Error("Choose an agent.");
  const key = z.string().uuid().parse(request.headers.get("idempotency-key"));
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
  if (input.pullRequestIntent && !input.pullRequestURL)
    throw new Error("Choose a pull request before selecting PR work.");
  if (input.execution) await validateExecution(input.execution);
  const account = input.githubAccount ?? project.githubAccount;
  const context =
    input.pullRequestURL && input.pullRequestIntent
      ? await withGithubAccount(account, () =>
          readPullRequestContext(input.pullRequestURL!, project),
        )
      : null;
  const pullRequest =
    context ??
    (input.pullRequestURL
      ? await withGithubAccount(account, () =>
          readPullRequestSource(input.pullRequestURL!, project),
        )
      : null);
  if (context && context.contextHash !== input.pullRequestContextHash)
    throw new Error(
      "The PR revision or feedback changed. Refresh the PR context, review it, and start again.",
    );
  const prompt = context
    ? `${input.prompt}\n\nGitHub context captured for this workspace:\n${context.feedback}`
    : input.prompt;
  const remoteRevision =
    project.repository && !pullRequest
      ? (
          await withGithubAccount(
            input.githubAccount ?? project.githubAccount,
            () =>
              readRemoteProject(project.repository!, undefined, project.branch),
          )
        ).headCommit
      : null;
  const response = store.command(`task:create:${key}`, () => {
    requireAvailableProject(store, input.projectId);
    const tools = validateAgentTools(
      store.get("settings", "default")!,
      input.tools,
    );
    const previous = input.pullRequestPreviousTaskId
      ? store.get("task", input.pullRequestPreviousTaskId)
      : null;
    if (
      input.pullRequestPreviousTaskId &&
      (!previous ||
        previous.projectId !== project.id ||
        !previous.pullRequests.some((pr) => pr.url === pullRequest?.pr.url))
    )
      throw new Error(
        "The previous workspace must belong to this PR and project.",
      );
    const attempt = pullRequest
      ? store
          .all("task")
          .filter(
            (task) =>
              task.projectId === project.id &&
              task.pullRequests.some((pr) => pr.url === pullRequest.pr.url),
          ).length + 1
      : 0;
    const intentLabel =
      input.pullRequestIntent === "address_feedback"
        ? "Address feedback"
        : input.pullRequestIntent === "resolve_conflicts"
          ? "Resolve conflicts"
          : "Review";
    const title =
      input.title ||
      (pullRequest
        ? `${intentLabel} #${pullRequest.pr.number} · workspace ${attempt} · ${pullRequest.pr.title}`.slice(
            0,
            160,
          )
        : input.prompt.split(/\n|(?<=[.!?])\s/)[0].slice(0, 72));
    const id = crypto.randomUUID();
    const inputId = crypto.randomUUID();
    const task: Task = {
      githubAccount: input.githubAccount ?? null,
      tools,
      sandbox: null,
      remoteRevision,
      source: pullRequest
        ? {
            ...pullRequest.source,
            intent: input.pullRequestIntent,
            previousTaskId: previous?.id,
          }
        : null,
      pullRequests: pullRequest ? [pullRequest.pr] : [],
      id,
      projectId: input.projectId,
      title,
      titleSource: input.title?.trim() || pullRequest ? "manual" : "prompt",
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
          text: prompt,
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
      text: prompt,
    });
    return task;
  });
  schedule();
  return json(response, 201);
}
