"use client";

import { useState } from "react";
import { GithubAccountPicker } from "@/features/settings/github-account-picker";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import {
  ExternalLink,
  GitPullRequest,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import {
  labels,
  taskSchema,
  pullRequestIntentSchema,
  pullRequestListStateSchema,
  type Execution,
  type Project,
  type PullRequest,
  type PullRequestIntent,
  type PullRequestListState,
  type Snapshot,
  type Task,
  type GithubAccountSelection,
} from "@nerilo/protocol";
import {
  Button,
  Heading,
  Text,
  TextInput,
  TextArea,
  Selector,
} from "@/components/ui/ui";
import { useQuery } from "@tanstack/react-query";
import { useApiMutation } from "@/lib/use-api-mutation";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { ModelPicker } from "@/components/composer/model-picker";
import { Modal } from "@/components/editors/editors";
import {
  PullRequestSignal,
  PullRequestBlockers,
  reviewLabels,
  checkLabels,
} from "@/features/review/pull-requests";
import "@/features/projects/project-pull-requests.css";
import {
  matchesPullRequest,
  pullRequestWorkspaces,
} from "@/features/projects/project-pr-model";

const intentLabels = {
  review: "Review code",
  address_feedback: "Address feedback",
  resolve_conflicts: "Resolve conflicts",
} satisfies Record<PullRequestIntent, string>;
const stateLabels = {
  open: "Open",
  merged: "Merged",
  closed: "Closed",
  all: "All states",
};

function instructions(pr: PullRequest, intent: PullRequestIntent) {
  const subject = `PR #${pr.number}: ${pr.title}.`;
  if (intent === "review")
    return `Review ${subject} Find actionable bugs and regressions introduced by the PR. Cite files and lines, explain the impact, and run relevant checks. Use the included review history to avoid repeating resolved feedback. Do not edit files or post a review to GitHub.`;
  if (intent === "address_feedback")
    return `Address the actionable review feedback on ${subject} Use the included formal reviews, unresolved inline discussions, and PR conversation. Explain any request that does not need a code change. Integrate the bundled current target branch when necessary, preserving teammates' changes. Add relevant regression coverage and run the checks. Leave the changes ready for review without pushing or posting to GitHub.`;
  return `Resolve the conflicts in ${subject} Merge the exact current target commit shown in the included context into the PR workspace, preserving both the PR's intended behavior and teammates' changes. Use the included review feedback to avoid regressions. Run the combined tests and explain the resolution. Leave the changes ready for review without pushing or posting to GitHub.`;
}

export function ProjectPullRequests({
  project,
  data,
  nav,
}: {
  project: Project;
  data: Snapshot;
  nav: (route: string) => void;
}) {
  const { machineId, ready } = useSession();
  const [state, setState] = useState<PullRequestListState>("open");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{
    pr: PullRequest;
    mode: "start" | "link";
  } | null>(null);
  const {
    data: result,
    isFetching: loading,
    error,
    refetch,
  } = useQuery({
    ...queries.pullRequests(machineId, project.id, state),
    enabled: ready,
  });
  const singularScope =
    state === "all" ? "pull request" : `${state} pull request`;
  const scope = `${singularScope}s`;
  const requests =
    result?.pullRequests.filter((pr) => matchesPullRequest(pr, query)) ?? [];
  const openTask = (event: React.MouseEvent<HTMLAnchorElement>, task: Task) => {
    event.preventDefault();
    nav(`task/${task.id}`);
  };
  return (
    <div className="project-pr-page">
      <header className="project-pr-heading">
        <div>
          <a
            href={`#project/${project.id}`}
            onClick={(event) => {
              event.preventDefault();
              nav(`project/${project.id}`);
            }}
            className="project-crumb"
          >
            {project.name}
          </a>
          <Heading level={1}>Pull requests</Heading>
        </div>
        <Button
          label="Refresh pull requests"
          isIconOnly
          variant="ghost"
          icon={<RefreshCw size={16} />}
          isLoading={loading}
          onClick={() => {
            void refetch();
          }}
        />
      </header>
      {error && (
        <div className="error-note" role="alert">
          {error.message}
        </div>
      )}
      <div className="project-pr-toolbar">
        <Selector
          label="PR status"
          value={state}
          onChange={(value) =>
            setState(pullRequestListStateSchema.parse(value))
          }
          options={Object.entries(stateLabels).map(([value, label]) => ({
            value,
            label,
          }))}
        />
        <div className="project-pr-search">
          <TextInput
            label={`Search loaded ${scope}`}
            isLabelHidden
            placeholder="Search pull requests"
            width="100%"
            value={query}
            onChange={setQuery}
            hasClear
          />
        </div>
      </div>
      {result?.repository && (
        <Text type="supporting" color="secondary" className="project-pr-scope">
          {result.limited
            ? `Latest 50 ${scope}`
            : `${result.pullRequests.length} ${result.pullRequests.length === 1 ? singularScope : scope}`}{" "}
          · Search covers this list, including authors.
        </Text>
      )}
      {!loading && !error && !requests.length && (
        <div className="pr-empty">
          <GitPullRequest size={24} />
          <Text as="p" color="secondary">
            {!result?.repository
              ? "This project needs a GitHub origin remote to browse pull requests."
              : query
                ? `No matches in the loaded ${scope}.`
                : `No ${scope}.`}
          </Text>
        </div>
      )}
      {loading && !result && (
        <Text as="p" color="secondary">
          Loading {scope}…
        </Text>
      )}
      <div className="project-pr-list">
        {requests.map((pr) => {
          const { linked, latest, continuing, preferred } =
            pullRequestWorkspaces(data.tasks, project.id, pr);
          return (
            <article className="project-pr-row" key={pr.url}>
              <span
                className={`pr-row-signal ${pr.checks}`}
                title={checkLabels[pr.checks]}
              >
                <PullRequestSignal pr={pr} />
              </span>
              <div className="project-pr-copy">
                <a
                  href={pr.url}
                  target="_blank"
                  rel="noreferrer"
                  className="project-pr-title"
                >
                  {pr.title}
                  <ExternalLink size={12} />
                </a>
                <PullRequestBlockers pr={pr} compact />
                <div className="project-pr-meta">
                  <span>#{pr.number}</span>
                  <span>
                    {pr.author ? `by @${pr.author}` : "Author unavailable"}
                  </span>
                  {pr.state !== "open" && (
                    <span>
                      {pr.state === "draft"
                        ? "Draft"
                        : pr.state === "merged"
                          ? "Merged"
                          : "Closed"}
                    </span>
                  )}
                </div>
                <details className="pr-row-checks">
                  <summary>
                    {checkLabels[pr.checks]} · {reviewLabels[pr.review]}
                  </summary>
                  <Text type="supporting">
                    {pr.head} → {pr.base}
                    {pr.headSha ? ` · published ${pr.headSha.slice(0, 7)}` : ""}
                  </Text>
                  {pr.checkRuns.map((check, index) => (
                    <div key={`${check.name}-${index}`}>
                      <span>{check.name}</span>
                      <span className={check.state}>{check.state}</span>
                    </div>
                  ))}
                  {!pr.checkRuns.length && (
                    <Text type="supporting">No checks reported by GitHub.</Text>
                  )}
                </details>
                {linked.length > 0 && (
                  <details className="pr-workspace-history">
                    <summary>
                      {linked.length === 1
                        ? "1 linked workspace"
                        : `${linked.length} linked workspaces`}
                    </summary>
                    <ol>
                      {linked.map((task) => {
                        const duplicateTitle = linked.some(
                          (other) =>
                            other.id !== task.id && other.title === task.title,
                        );
                        return (
                          <li key={task.id}>
                            <a
                              href={`#task/${task.id}`}
                              onClick={(event) => openTask(event, task)}
                            >
                              {task.title}
                              {duplicateTitle
                                ? ` · workspace ${task.id.slice(0, 8)}`
                                : ""}
                            </a>
                            <span>
                              {[
                                task.id === latest?.id ? "Latest" : null,
                                task.archived
                                  ? "Archived"
                                  : labels[task.status],
                                task.source?.intent
                                  ? intentLabels[task.source.intent]
                                  : null,
                                task.source
                                  ? `Started at ${task.source.headCommit.slice(0, 7)}`
                                  : null,
                                duplicateTitle
                                  ? null
                                  : `workspace ${task.id.slice(0, 8)}`,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                  </details>
                )}
              </div>
              <div className="project-pr-actions">
                <Button
                  label={
                    continuing
                      ? "Continue task"
                      : preferred
                        ? "Open task"
                        : "New workspace"
                  }
                  isDisabled={project.archived && !preferred}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    preferred
                      ? nav(`task/${preferred.id}`)
                      : setDialog({ pr, mode: "start" })
                  }
                />
                <DropdownMenu
                  hasChevron={false}
                  alignment="end"
                  button={{
                    label: `Actions for PR #${pr.number}`,
                    isIconOnly: true,
                    variant: "ghost",
                    size: "sm",
                    icon: <MoreHorizontal size={16} />,
                  }}
                  items={[
                    {
                      label: "New workspace…",
                      isDisabled: project.archived,
                      onClick: () => setDialog({ pr, mode: "start" }),
                    },
                    {
                      label: "Link to existing task",
                      isDisabled: project.archived,
                      onClick: () => setDialog({ pr, mode: "link" }),
                    },
                  ]}
                />
              </div>
            </article>
          );
        })}
      </div>
      {dialog && (
        <PRTaskDialog
          key={`${dialog.pr.url}-${dialog.mode}`}
          {...dialog}
          project={project}
          data={data}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            if (id) nav(`task/${id}`);
          }}
        />
      )}
    </div>
  );
}

function PRTaskDialog({
  pr,
  mode,
  project,
  data,
  onClose,
  onSaved,
}: {
  pr: PullRequest;
  mode: "start" | "link";
  project: Project;
  data: Snapshot;
  onClose: () => void;
  onSaved: (id?: string) => void;
}) {
  const { machineId, ready } = useSession();
  const { mutateAsync: send } = useApiMutation();
  const available = data.tasks.filter(
    (task) =>
      task.projectId === project.id &&
      !task.archived &&
      !task.pullRequests.some((item) => item.url === pr.url),
  );
  const { preferred: previous, continuing } = pullRequestWorkspaces(
    data.tasks,
    project.id,
    pr,
  );
  const [taskId, setTaskId] = useState(available[0]?.id ?? "");
  const [githubAccount, setGithubAccount] =
    useState<GithubAccountSelection | null>(null);
  const [intent, setIntent] = useState<PullRequestIntent>(
    pr.conflicts
      ? "resolve_conflicts"
      : pr.review === "changes_requested"
        ? "address_feedback"
        : "review",
  );
  const [presetId, setPresetId] = useState(
    data.presets.find(
      (preset) =>
        preset.id === (intent === "review" ? "reviewer" : "programmer"),
    )?.id ??
      data.presets[0]?.id ??
      "",
  );
  const initialPreset = data.presets.find((preset) => preset.id === presetId);
  const [execution, setExecution] = useState<Execution>({
    provider: initialPreset?.provider ?? "codex",
    model: initialPreset?.model ?? "",
    effort: "",
  });
  const [prompt, setPrompt] = useState(instructions(pr, intent));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const context = useQuery({
    ...queries.pullRequestContext(
      machineId,
      project.id,
      pr.url,
      githubAccount ?? project.githubAccount,
    ),
    enabled: ready && mode === "start",
  });
  const selectPreset = (id: string) => {
    setPresetId(id);
    const preset = data.presets.find((item) => item.id === id);
    if (preset)
      setExecution({
        provider: preset.provider,
        model: preset.model,
        effort: "",
      });
  };
  const canSubmit =
    mode === "link"
      ? !!taskId
      : !!prompt.trim() &&
        !!presetId &&
        !!context.data &&
        !context.isFetching &&
        !context.isError;
  const submit = async () => {
    if (busy || !canSubmit) return;
    setBusy(true);
    setError("");
    try {
      if (mode === "link") {
        await send({
          path: `tasks/${taskId}/pull-requests`,
          body: { url: pr.url },
        });
        onSaved();
      } else {
        const task = taskSchema.parse(
          await send({
            path: "tasks",
            body: {
              projectId: project.id,
              githubAccount,
              presetId,
              prompt,
              execution,
              pullRequestURL: pr.url,
              pullRequestIntent: intent,
              pullRequestContextHash: context.data!.contextHash,
              pullRequestPreviousTaskId: previous?.id,
            },
          }),
        );
        onSaved(task.id);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      if (mode === "start") void context.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      onSubmit={() => void submit()}
      title={
        mode === "link"
          ? `Link PR #${pr.number}`
          : `New workspace for PR #${pr.number}`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          label={mode === "link" ? "Link PR" : "Start new workspace"}
          variant="primary"
          isLoading={busy}
          isDisabled={busy || !canSubmit}
          onClick={() => void submit()}
        />
      }
    >
      <Text weight="medium">{pr.title}</Text>
      {mode === "link" ? (
        available.length ? (
          <Selector
            label="Task"
            value={taskId}
            onChange={setTaskId}
            options={available.map((task) => ({
              value: task.id,
              label: task.title,
            }))}
          />
        ) : (
          <Text color="secondary">No unlinked tasks in this project.</Text>
        )
      ) : (
        <>
          {previous ? (
            <div className="pr-existing-workspace">
              <Text as="p" type="supporting">
                This creates a separate workspace from the current PR. Your
                existing workspace and conversation stay intact.
              </Text>
              <Button
                label={
                  continuing ? "Continue existing task" : "Open existing task"
                }
                size="sm"
                variant="secondary"
                onClick={() => onSaved(previous.id)}
                isDisabled={busy}
              />
            </div>
          ) : (
            <Text type="supporting">
              Starts from the PR's current revision in a separate workspace.
            </Text>
          )}
          <Selector
            label="Work to do"
            value={intent}
            onChange={(value) => {
              const next = pullRequestIntentSchema.parse(value);
              setIntent(next);
              setPrompt(instructions(pr, next));
              selectPreset(
                data.presets.find(
                  (preset) =>
                    preset.id ===
                    (next === "review" ? "reviewer" : "programmer"),
                )?.id ?? presetId,
              );
            }}
            options={Object.entries(intentLabels).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <Selector
            label="Agent"
            value={presetId}
            onChange={selectPreset}
            options={data.presets.map((preset) => ({
              value: preset.id,
              label: preset.name,
            }))}
          />
          <div className="pr-task-options">
            <ModelPicker
              value={execution}
              onChange={setExecution}
              connections={data.runtime.connections}
            />
            <GithubAccountPicker
              scope="task"
              value={githubAccount}
              inherited={project.githubAccount}
              onChange={setGithubAccount}
              disabled={busy}
              compact
            />
          </div>
          <TextArea label="Instructions" value={prompt} onChange={setPrompt} />
          <div className="pr-import-context">
            <div className="pr-import-context-heading">
              <Text weight="medium">GitHub context included</Text>
              <Button
                label="Refresh PR context"
                isIconOnly
                size="sm"
                variant="ghost"
                icon={<RefreshCw size={14} />}
                isLoading={context.isFetching}
                isDisabled={busy}
                onClick={() => {
                  void context.refetch();
                }}
              />
            </div>
            {context.isPending && (
              <Text type="supporting">
                Loading revisions, reviews, and discussions…
              </Text>
            )}
            {context.error && (
              <div role="alert" className="error-note">
                {context.error.message}
              </div>
            )}
            {context.data && (
              <>
                <Text as="p" type="supporting">
                  PR {context.data.source.headCommit.slice(0, 7)} · current{" "}
                  {context.data.pr.base}{" "}
                  {context.data.source.baseCommit.slice(0, 7)}
                </Text>
                <details>
                  <summary>
                    Read captured feedback and revision context (
                    {context.data.feedbackCount})
                  </summary>
                  <pre>{context.data.feedback}</pre>
                </details>
              </>
            )}
          </div>
        </>
      )}
      {error && (
        <div role="alert" className="error-note">
          {error}
        </div>
      )}
    </Modal>
  );
}
