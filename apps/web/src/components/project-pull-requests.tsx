"use client";
import { useCallback, useEffect, useState } from "react";
import { DropdownMenu } from "@astryxdesign/core";
import {
  ExternalLink,
  GitPullRequest,
  MoreHorizontal,
  RefreshCw,
} from "lucide-react";
import {
  projectPullRequestsSchema,
  taskSchema,
  type Execution,
  type Project,
  type PullRequest,
  type Snapshot,
} from "@nerilo/protocol";
import { read, mutate } from "@/lib/api";
import {
  Button,
  Heading,
  Text,
  TextInput,
  TextArea,
  Selector,
} from "@/components/ui";
import { ModelPicker } from "@/components/model-picker";
import { Modal } from "@/components/editors";
import {
  PullRequestSignal,
  reviewLabels,
  checkLabels,
} from "@/components/pull-requests";

export function ProjectPullRequests({
  project,
  data,
  nav,
  refresh,
}: {
  project: Project;
  data: Snapshot;
  nav: (route: string) => void;
  refresh: () => void;
}) {
  const [result, setResult] = useState<ReturnType<
    typeof projectPullRequestsSchema.parse
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState<{
    pr: PullRequest;
    mode: "start" | "link";
  } | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setResult(
        projectPullRequestsSchema.parse(
          await read(`projects/${project.id}/pull-requests`),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [project.id]);
  useEffect(() => {
    void load();
  }, [load]);
  const requests =
    result?.pullRequests.filter((pr) =>
      `${pr.title} #${pr.number} ${pr.head}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
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
          onClick={() => void load()}
        />
      </header>
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
      {result?.repository && (
        <div className="project-pr-toolbar">
          <Text color="secondary">
            Open
            {result.limited
              ? " · latest 50"
              : ` · ${result.pullRequests.length}`}
          </Text>
          <TextInput
            label="Search pull requests"
            isLabelHidden
            placeholder="Find a pull request…"
            value={query}
            onChange={setQuery}
            hasClear
          />
        </div>
      )}
      {!loading && !error && !requests.length && (
        <div className="pr-empty">
          <GitPullRequest size={24} />
          <Text as="p" color="secondary">
            {!result?.repository
              ? "This project needs a GitHub origin remote to browse pull requests."
              : query
                ? "No matching pull requests."
                : "No open pull requests."}
          </Text>
        </div>
      )}
      {loading && !result && (
        <Text as="p" color="secondary">
          Loading pull requests…
        </Text>
      )}
      <div className="project-pr-list">
        {requests.map((pr) => {
          const linked = data.tasks.filter(
            (task) =>
              task.projectId === project.id &&
              !task.archived &&
              task.pullRequests.some((item) => item.url === pr.url),
          );
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
                <div className="project-pr-meta">
                  <span>#{pr.number}</span>
                  {pr.state === "draft" && <span>Draft</span>}
                  <span title={`${pr.head} → ${pr.base}`}>{pr.head}</span>
                </div>
                <details className="pr-row-checks">
                  <summary>
                    {checkLabels[pr.checks]} · {reviewLabels[pr.review]}
                    {pr.conflicts ? " · Conflicts" : ""}
                  </summary>
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
                  <div className="pr-linked-tasks">
                    {linked.map((task) => (
                      <a
                        key={task.id}
                        href={`#task/${task.id}`}
                        onClick={(event) => {
                          event.preventDefault();
                          nav(`task/${task.id}`);
                        }}
                      >
                        {task.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              <div className="project-pr-actions">
                <Button
                  label="Work on PR"
                  isDisabled={project.archived}
                  size="sm"
                  variant="secondary"
                  onClick={() => setDialog({ pr, mode: "start" })}
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
                      label: "Link to existing task",
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
            refresh();
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
  const available = data.tasks.filter(
    (task) =>
      task.projectId === project.id &&
      !task.archived &&
      !task.pullRequests.some((item) => item.url === pr.url),
  );
  const [taskId, setTaskId] = useState(available[0]?.id ?? "");
  const [presetId, setPresetId] = useState(
    data.presets.find((preset) => preset.id === "reviewer")?.id ??
      data.presets[0]?.id ??
      "",
  );
  const initialPreset = data.presets.find((preset) => preset.id === presetId);
  const [execution, setExecution] = useState<Execution>({
    provider: initialPreset?.provider ?? "codex",
    model: initialPreset?.model ?? "",
    effort: "",
  });
  const [prompt, setPrompt] = useState(
    `Review PR #${pr.number}: ${pr.title}. Find actionable bugs and regressions introduced by the PR. Cite files and lines, explain the impact, and run relevant checks. Do not edit files or post a review to GitHub.`,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async () => {
    if (busy || (mode === "link" ? !taskId : !prompt.trim() || !presetId))
      return;
    setBusy(true);
    setError("");
    try {
      if (mode === "link") {
        await mutate(`tasks/${taskId}/pull-requests`, { url: pr.url });
        onSaved();
      } else {
        const task = taskSchema.parse(
          await mutate("tasks", {
            projectId: project.id,
            presetId,
            prompt,
            execution,
            title: `#${pr.number} · ${pr.title}`.slice(0, 160),
            pullRequestURL: pr.url,
          }),
        );
        onSaved(task.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      onSubmit={() => void submit()}
      title={
        mode === "link" ? `Link PR #${pr.number}` : `Work on PR #${pr.number}`
      }
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          label={mode === "link" ? "Link PR" : "Start task"}
          variant="primary"
          isLoading={busy}
          isDisabled={
            busy || (mode === "link" ? !taskId : !prompt.trim() || !presetId)
          }
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
          <Text type="supporting">
            Starts from this PR's latest revision in a separate workspace.
          </Text>
          <Selector
            label="Agent"
            value={presetId}
            onChange={(id) => {
              setPresetId(id);
              const preset = data.presets.find((item) => item.id === id);
              if (preset)
                setExecution({
                  provider: preset.provider,
                  model: preset.model,
                  effort: "",
                });
            }}
            options={data.presets.map((preset) => ({
              value: preset.id,
              label: preset.name,
            }))}
          />
          <ModelPicker value={execution} onChange={setExecution} />
          <TextArea label="Instructions" value={prompt} onChange={setPrompt} />
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
