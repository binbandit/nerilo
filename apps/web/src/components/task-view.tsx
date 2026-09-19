"use client";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DropdownMenu } from "@astryxdesign/core";
import { MessageComposer } from "@/components/message-composer";
import {
  ArrowLeft,
  ArrowDownToLine,
  Pause,
  Play,
  Check,
  Archive,
  FileCode2,
  AlertCircle,
  Clock3,
  Pencil,
  X,
  MoreHorizontal,
  PanelRight,
  Activity,
  GitPullRequest,
  FolderGit2,
  FolderOpen,
  Sparkles,
  Shield,
  ChevronRight,
} from "lucide-react";
import {
  activeStatuses,
  requestLabel,
  type TaskDetail,
  type Snapshot,
} from "@nerilo/protocol";
import { Button, Heading, Text, TextInput, relativeTime } from "./ui";
import { Modal } from "./editors";
import { apiUrl, mutate } from "@/lib/api";
import { ModelPicker } from "@/components/model-picker";
import { AgentToolsPicker } from "@/components/agent-tools-picker";
import { ProviderIcon } from "@/components/provider-icon";
import {
  ActivityEntry,
  TurnActivity,
  VerificationOutput,
} from "@/components/task-activity";
import { TaskQueue } from "@/components/task-queue";
import { SchedulePicker, scheduledTime } from "@/components/schedule-picker";
import { TaskAutonomy } from "@/components/task-autonomy";
import { SandboxDialog } from "@/components/sandbox-controls";
import { TaskGitActions } from "@/components/task-git-actions";
import { useDraft } from "@/lib/use-draft";
import { useMachines } from "@/lib/machines";
import { CodeText } from "@/components/code-text";
import { DiffReview } from "@/components/diff-review";
import { TaskFileBrowser } from "@/components/task-file-browser";
import { focusComposer } from "@/lib/keyboard";
import { TaskStateSummary } from "@/components/task-state-summary";
import { PullRequests } from "@/components/pull-requests";
import { TaskTimeline } from "@/components/task-timeline";
import { CopyTextButton } from "@/components/copy-text-button";
import "./turn-instructions.css";

export function TaskView({
  detail,
  data,
  refresh,
  onRestoreProject,
}: {
  detail: TaskDetail;
  data: Snapshot;
  refresh: () => void;
  onRestoreProject: () => void;
}) {
  const { task, turns, events } = detail;
  const [tab, setTab] = useState<
    "conversation" | "changes" | "activity" | "files"
  >("conversation");
  const { current, currentId } = useMachines();
  const [prompt, setPrompt] = useDraft(`task:${task.id}`);
  const [scheduledAt, setScheduledAt] = useDraft(`task-schedule:${task.id}`);
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<
    "apply" | "rename" | "checkout" | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [title, setTitle] = useState(task.title);
  const [showDetails, setShowDetails] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const taskActionsRef = useRef<HTMLButtonElement>(null);
  const [linkPR, setLinkPR] = useState(false);
  const [prURL, setPrURL] = useState("");
  const project = data.projects.find((p) => p.id === task.projectId);
  const latest = turns.at(-1);
  const result = latest?.result;
  const running = activeStatuses.includes(task.status);
  const nextScheduledAt =
    task.status === "queued" &&
    task.pending.length > 0 &&
    task.pending.every(
      (input) =>
        input.scheduledAt && Date.parse(input.scheduledAt) > Date.now(),
    )
      ? task.pending.map((input) => input.scheduledAt!).sort()[0]
      : null;
  const priorResult = [...turns].reverse().find((t) => t.result)?.result;
  const act = async (action: string, body: unknown = {}) => {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(true);
    setError("");
    try {
      await mutate(`tasks/${task.id}/${action}`, body);
      refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      actionPending.current = false;
      setBusy(false);
    }
  };
  const linkPullRequest = async () => {
    if (busy || !prURL.trim()) return;
    if (await act("pull-requests", { url: prURL })) {
      setLinkPR(false);
      setPrURL("");
    }
  };
  const finishConfirmation = async () => {
    if (
      !confirm ||
      actionPending.current ||
      (confirm === "rename" && !title.trim())
    )
      return;
    if (confirm === "checkout") {
      actionPending.current = true;
      setBusy(true);
      setError("");
      try {
        const value: unknown = await mutate(`tasks/${task.id}/checkout`, {
          turnId: latest?.id,
        });
        if (
          !value ||
          typeof value !== "object" ||
          !("path" in value) ||
          typeof value.path !== "string"
        )
          throw new Error("Could not read the exported folder.");
        setExported(value.path);
        setConfirm(null);
        setCopied(false);
        refresh();
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Export failed.");
      } finally {
        actionPending.current = false;
        setBusy(false);
      }
      return;
    }
    if (
      await act(
        confirm,
        confirm !== "rename" ? { turnId: latest?.id } : { title },
      )
    ) {
      setConfirm(null);
    }
  };
  useEffect(() => {
    if (!showDetails) return;
    const frame = requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(".evidence-rail button")
        ?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [showDetails]);
  const submit = async (value: string) => {
    if (busy || !value.trim()) return;
    if (
      await act("follow-up", { text: value, scheduledAt: scheduledAt || null })
    ) {
      setPrompt("");
      setScheduledAt("");
    }
  };
  const [reviewTurnId, setReviewTurnId] = useState<string | null>(null);
  const reviewTurn =
    turns.find((turn) => turn.id === reviewTurnId) ??
    [...turns].reverse().find((turn) => turn.result);
  const reviewResult = reviewTurn?.result;
  const reviewHeadingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (tab !== "changes") return;
    const frame = requestAnimationFrame(() => {
      reviewHeadingRef.current
        ?.closest(".task-page")
        ?.scrollIntoView({ block: "start" });
      reviewHeadingRef.current
        ?.querySelector("button")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab, reviewTurn?.id]);
  const openReview = (turnId = reviewTurn?.id) => {
    setReviewTurnId(turnId ?? null);
    setShowDetails(false);
    setTab("changes");
  };
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const openFile = (path: string) => {
    setSelectedFile(path);
    setShowDetails(false);
    setTab("files");
  };
  return (
    <div className="task-page">
      <header className="task-header">
        <div className="task-title-line">
          <div>
            <Text type="supporting">
              {project?.name}
              {currentId !== "local" && current ? ` · ${current.name}` : ""}
            </Text>
            <Heading level={1}>{task.title}</Heading>
          </div>
        </div>
        <div className="task-actions">
          <PullRequests task={task} onUpdate={refresh} variant="header" />
          <span className={`task-state ${task.status}`}>
            {nextScheduledAt
              ? "Scheduled"
              : task.status === "check_failed"
                ? "Verification failed"
                : task.status === "ready"
                  ? "Ready"
                  : task.status[0].toUpperCase() + task.status.slice(1)}
          </span>
          {running ? (
            <Button
              label="Pause"
              isIconOnly
              icon={<Pause size={16} />}
              onClick={() => void act("pause")}
              isDisabled={busy || task.stopRequested}
            />
          ) : !project?.archived &&
            ["failed", "paused"].includes(task.status) ? (
            <Button
              label={task.status === "failed" ? "Retry" : "Resume"}
              icon={<Play size={14} />}
              onClick={() => void act("retry")}
              isLoading={busy}
            />
          ) : null}
          {tab !== "conversation" && (
            <Button
              label="Conversation"
              icon={<ArrowLeft size={16} />}
              variant="ghost"
              onClick={() => {
                setTab("conversation");
                requestAnimationFrame(() => focusComposer());
              }}
            />
          )}
          {project?.archived ? (
            <Button label="Changes" onClick={() => setTab("changes")} />
          ) : (
            <TaskGitActions
              task={task}
              turnId={latest?.id}
              onRefresh={refresh}
              triggerLabel="Changes"
              onOpenChange={(open) => {
                if (open) setShowDetails(false);
              }}
              onViewDiff={() => openReview(latest?.id)}
            />
          )}
          {!project?.archived && (
            <TaskAutonomy
              task={task}
              base={project?.branch ?? "main"}
              refresh={refresh}
            />
          )}
          <Button
            label="Task details"
            isIconOnly
            icon={<PanelRight size={17} />}
            variant="ghost"
            aria-pressed={showDetails}
            onClick={() => {
              if (tab !== "conversation") {
                setTab("conversation");
                setShowDetails(true);
              } else setShowDetails(!showDetails);
            }}
          />
          <DropdownMenu
            hasChevron={false}
            alignment="end"
            button={{
              label: "Task actions",
              ref: taskActionsRef,
              isIconOnly: true,
              icon: <MoreHorizontal size={18} />,
              variant: "ghost",
            }}
            items={[
              {
                label: "Review changes",
                icon: <FileCode2 size={15} />,
                isDisabled: !turns.some((turn) => turn.result?.diff),
                onClick: () => openReview(),
              },
              {
                label: "Browse files",
                icon: <FolderOpen size={15} />,
                isDisabled: !turns.length,
                onClick: () => {
                  setShowDetails(false);
                  setTab("files");
                },
              },
              {
                label: "Link pull request",
                isDisabled: project?.archived,
                icon: <GitPullRequest size={15} />,
                onClick: () => setLinkPR(true),
              },
              {
                label: "Rename",
                isDisabled: project?.archived,
                icon: <Pencil size={15} />,
                onClick: () => {
                  setTitle(task.title);
                  setConfirm("rename");
                },
              },
              {
                label: "Rename with AI",
                icon: <Sparkles size={15} />,
                isDisabled: busy || running || project?.archived,
                onClick: () => void act("metadata"),
              },
              {
                label: "Sandbox settings",
                icon: <Shield size={15} />,
                isDisabled: project?.archived,
                onClick: () => {
                  taskActionsRef.current?.focus();
                  setShowSandbox(true);
                },
              },
              {
                label: "Activity",
                icon: <Activity size={15} />,
                onClick: () => setTab("activity"),
              },
              {
                label: "Export project",
                icon: <FolderGit2 size={15} />,
                isDisabled: busy || running || !result || result.truncated,
                onClick: () => setConfirm("checkout"),
              },
              {
                label: "Mark complete",
                icon: <Check size={15} />,
                isDisabled:
                  busy ||
                  project?.archived ||
                  !["ready", "check_failed"].includes(task.status),
                onClick: () => void act("complete"),
              },
              { type: "divider" },
              {
                label: task.archived ? "Restore" : "Archive",
                icon: <Archive size={15} />,
                isDisabled: running || busy,
                onClick: () =>
                  void act("archive", { archived: !task.archived }),
              },
            ]}
          />
        </div>
      </header>
      {showSandbox && !project?.archived && (
        <SandboxDialog
          task={task}
          defaults={data.settings.sandbox}
          onSaved={refresh}
          onClose={() => {
            setShowSandbox(false);
            requestAnimationFrame(() => taskActionsRef.current?.focus());
          }}
        />
      )}
      {project?.archived && (
        <div className="project-archive-notice">
          <Text color="secondary">This project is archived.</Text>
          <Button
            label="Restore project"
            size="sm"
            onClick={onRestoreProject}
          />
        </div>
      )}
      {error && !confirm && !linkPR && (
        <div role="alert" className="error-note">
          {error}
        </div>
      )}
      {task.error && (
        <div className="attention-note">
          <AlertCircle size={18} />
          <div>
            <Text>{task.error}</Text>
          </div>
        </div>
      )}
      {task.status === "queued" && (
        <div className="attention-note">
          <Clock3 size={18} />
          <Text>
            {nextScheduledAt
              ? `Scheduled for ${scheduledTime(nextScheduledAt)}`
              : !data.runtime.docker
                ? "Open Docker Desktop to start."
                : !data.runtime.image
                  ? "Prepare the agent environment in Settings."
                  : "Queued"}
          </Text>
        </div>
      )}
      <div
        className={`task-layout ${tab === "changes" ? "with-diff-review" : ""} ${tab === "files" ? "with-file-browser" : ""} ${showDetails && tab === "conversation" ? "with-details" : ""}`}
      >
        <section className="conversation-column" aria-label={tab}>
          {tab === "conversation" ? (
            <>
              <div className="conversation-history">
                <TaskStateSummary
                  taskId={task.id}
                  turnId={turns.at(-1)?.id}
                  revision={detail.events.at(-1)?.seq ?? 0}
                />
                <TaskTimeline
                  turns={turns}
                  events={events}
                  provider={task.provider}
                  renderTurn={(turn, index) => {
                    const turnEvents = events.filter(
                      (e) => e.turnId === turn.id,
                    );
                    const activity = turnEvents.filter(
                      (e) =>
                        e.kind === "activity" ||
                        e.kind === "check" ||
                        e.kind === "error",
                    );
                    const response =
                      turn.result?.summary ||
                      turnEvents.filter((e) => e.kind === "assistant").at(-1)
                        ?.text;
                    const current = index === turns.length - 1;
                    const automaticRequest = requestLabel(
                      turn.prompt,
                      turn.requestOrigin,
                    );
                    return (
                      <details
                        className="turn-card"
                        key={turn.id}
                        open={current ? true : undefined}
                      >
                        <summary className="turn-request">
                          <span className="turn-prompt">
                            {!automaticRequest &&
                              turn.result?.metadata?.promptSummary && (
                                <span className="turn-prompt-short">
                                  {turn.result.metadata.promptSummary}
                                </span>
                              )}
                            <span className="turn-prompt-full">
                              {automaticRequest ?? turn.prompt}
                            </span>
                          </span>
                          <CopyTextButton
                            text={turn.prompt}
                            label="Copy prompt"
                          />
                          <time dateTime={turn.startedAt}>
                            {relativeTime(turn.startedAt)}
                          </time>
                        </summary>
                        <div className="turn-response">
                          {automaticRequest && (
                            <details className="turn-instructions">
                              <summary>
                                {turn.requestOrigin?.kind === "review"
                                  ? "Review context"
                                  : "Autopilot instructions"}{" "}
                                <ChevronRight size={12} aria-hidden="true" />
                              </summary>
                              <pre
                                tabIndex={0}
                                aria-label="Full agent instructions"
                              >
                                {turn.prompt}
                              </pre>
                            </details>
                          )}
                          <TurnActivity events={activity}>
                            <ProviderIcon
                              provider={
                                turn.execution?.provider ??
                                task.sessionProvider ??
                                task.provider
                              }
                            />
                            <Text type="supporting">
                              {(turn.execution?.provider ??
                                task.sessionProvider ??
                                task.provider) === "codex"
                                ? "Codex"
                                : "Claude Code"}
                              {turn.execution?.model
                                ? ` · ${turn.execution.model}`
                                : ""}
                            </Text>
                          </TurnActivity>
                          {response && (
                            <div className="prose">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                disallowedElements={["img"]}
                                components={{
                                  pre: ({ children }) => (
                                    <pre tabIndex={0} aria-label="Code block">
                                      {children}
                                    </pre>
                                  ),
                                  code: ({ children, className }) => (
                                    <code className={className}>
                                      <CodeText
                                        text={String(children ?? "")}
                                        language={
                                          className?.match(
                                            /language-([^\s]+)/,
                                          )?.[1]
                                        }
                                      />
                                    </code>
                                  ),
                                  a: ({ children, href }) =>
                                    href?.startsWith("/work/repo/") ? (
                                      <button
                                        className="inline-file-link"
                                        onClick={() =>
                                          void openFile(
                                            href
                                              .slice(11)
                                              .replace(/:\d+(?::\d+)?$/, ""),
                                          )
                                        }
                                      >
                                        {children}
                                      </button>
                                    ) : (
                                      <a
                                        href={href}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {children}
                                      </a>
                                    ),
                                }}
                              >
                                {response}
                              </ReactMarkdown>
                            </div>
                          )}
                          {response && (
                            <div className="response-copy-actions">
                              <CopyTextButton
                                text={response}
                                label="Copy response"
                              />
                              {turn.result?.diff && (
                                <Button
                                  label={`Review ${turn.result.changes.length} ${turn.result.changes.length === 1 ? "file" : "files"}`}
                                  variant="ghost"
                                  size="sm"
                                  icon={<FileCode2 size={14} />}
                                  onClick={() => openReview(turn.id)}
                                />
                              )}
                            </div>
                          )}
                          {current && running && (
                            <div className="live-activity">
                              <span className="working-dot" />
                              <Text type="supporting">
                                {task.stopRequested
                                  ? "Pausing…"
                                  : (turnEvents
                                      .filter((e) => e.kind === "activity")
                                      .at(-1)
                                      ?.text.split("\n")[0]
                                      .slice(0, 160) ?? "Preparing…")}
                              </Text>
                            </div>
                          )}
                          {turn.result?.verification && (
                            <VerificationOutput
                              verification={turn.result.verification}
                            />
                          )}
                        </div>
                      </details>
                    );
                  }}
                />
              </div>
            </>
          ) : tab === "files" ? (
            <TaskFileBrowser
              taskId={task.id}
              revision={`${latest?.id ?? ""}:${latest?.status ?? ""}`}
              changes={result?.changes ?? []}
              selectedPath={selectedFile}
              onSelect={setSelectedFile}
              onReference={
                task.archived || project?.archived
                  ? undefined
                  : (path) => {
                      setPrompt(
                        (prompt ? `${prompt}\n\n` : "") +
                          `Take a look at ${JSON.stringify(path)}: `,
                      );
                      requestAnimationFrame(() => focusComposer());
                    }
              }
            />
          ) : tab === "activity" ? (
            <div className="activity-list">
              {events.filter((e) =>
                ["activity", "check", "error"].includes(e.kind),
              ).length ? (
                events
                  .filter((e) =>
                    ["activity", "check", "error"].includes(e.kind),
                  )
                  .map((e) => <ActivityEntry key={e.seq} event={e} showTime />)
              ) : (
                <div className="empty-list">
                  <Clock3 size={24} />
                  <Text color="secondary">
                    Activity will appear when the task begins.
                  </Text>
                </div>
              )}
            </div>
          ) : (
            <div className="changes-view">
              {reviewResult ? (
                <>
                  <div className="review-heading" ref={reviewHeadingRef}>
                    <DropdownMenu
                      button={{
                        label: `Turn ${turns.findIndex((turn) => turn.id === reviewTurn?.id) + 1} · ${reviewResult.changes.length} ${reviewResult.changes.length === 1 ? "file" : "files"}`,
                        variant: "ghost",
                        size: "sm",
                      }}
                      items={turns.flatMap((turn, index) =>
                        turn.result
                          ? [
                              {
                                label: `Turn ${index + 1}`,
                                description: turn.prompt.slice(0, 100),
                                onClick: () => openReview(turn.id),
                              },
                            ]
                          : [],
                      )}
                    />
                    {reviewTurn?.id === latest?.id && (
                      <div className="row">
                        {!running && !reviewResult.truncated && (
                          <Button
                            label="Export project"
                            variant="ghost"
                            size="sm"
                            icon={<FolderGit2 size={15} />}
                            onClick={() => setConfirm("checkout")}
                          />
                        )}
                        {reviewResult.diff &&
                          !reviewResult.truncated &&
                          !running &&
                          project?.path &&
                          !task.includeChanges &&
                          !project?.archived && (
                            <Button
                              label="Apply changes"
                              variant="primary"
                              onClick={() => setConfirm("apply")}
                            />
                          )}
                        <Button
                          label="Export patch"
                          variant="ghost"
                          size="sm"
                          icon={<ArrowDownToLine size={15} />}
                          href={apiUrl(`tasks/${task.id}/patch`)}
                          isDisabled={reviewResult.truncated}
                        />
                      </div>
                    )}
                  </div>
                  {reviewResult.truncated && (
                    <div className="attention-note">
                      This diff exceeds the preview limit. Patch export and
                      application are unavailable.
                    </div>
                  )}
                  {reviewResult.diff ? (
                    <DiffReview
                      key={`${task.id}:${reviewTurn!.id}:${reviewResult.headCommit}`}
                      taskId={task.id}
                      turnId={reviewTurn!.id}
                      revision={reviewResult.headCommit}
                      baseRevision={reviewResult.baseCommit}
                      text={reviewResult.diff}
                      running={running}
                      readOnly={
                        task.archived ||
                        project?.archived ||
                        reviewResult.truncated
                      }
                      onSend={async (text, commentCount) => {
                        const sent = await act("follow-up", {
                          text,
                          requestOrigin: { kind: "review", commentCount },
                        });
                        if (sent) setTab("conversation");
                        return sent;
                      }}
                    />
                  ) : (
                    <div className="empty-list">
                      <FileCode2 size={24} />
                      <Text color="secondary">
                        No file changes in this result.
                      </Text>
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-list">
                  <FileCode2 size={24} />
                  <Text color="secondary">
                    Changes will appear when this turn finishes.
                  </Text>
                  {priorResult && (
                    <Text type="supporting">
                      Previous work is retained. This view will update with the
                      new result.
                    </Text>
                  )}
                </div>
              )}
            </div>
          )}
          {tab !== "changes" && (
            <TaskQueue
              key={task.id}
              readOnly={project?.archived}
              task={task}
              refresh={refresh}
              useAsFollowUp={(text) =>
                setPrompt(prompt ? `${prompt}\n\n${text}` : text)
              }
            />
          )}
          {tab !== "changes" && !task.archived && !project?.archived && (
            <div className="follow-up" data-keyboard-region="composer">
              <MessageComposer
                value={prompt}
                onChange={setPrompt}
                placeholder={
                  running ? "Add direction for the next turn…" : "Follow up…"
                }
                onSubmit={(value) => void submit(value)}
                isDisabled={busy}
                elevation="none"
                footerActions={
                  <div className="task-composer-controls">
                    <ModelPicker
                      value={{
                        provider: task.provider,
                        model: task.model,
                        effort: task.effort,
                      }}
                      running={running}
                      onChange={async (execution) => {
                        await mutate(`tasks/${task.id}/execution`, execution);
                        refresh();
                      }}
                    />
                    <AgentToolsPicker
                      key={task.id}
                      skills={data.settings.skills}
                      servers={data.settings.mcpServers}
                      value={task.tools}
                      running={running}
                      onChange={async (tools) => {
                        await mutate(`tasks/${task.id}/tools`, tools);
                        refresh();
                      }}
                    />
                    <SchedulePicker
                      value={scheduledAt || null}
                      disabled={busy}
                      onChange={(value) => setScheduledAt(value ?? "")}
                    />
                  </div>
                }
              />
            </div>
          )}
        </section>
        {showDetails && tab === "conversation" && (
          <aside
            className="evidence-rail"
            data-keyboard-region="details"
            tabIndex={-1}
            aria-label="Task details"
          >
            <div className="evidence-heading">
              <Text weight="medium">
                Files
                {result?.changes.length ? ` · ${result.changes.length}` : ""}
              </Text>
              <Button
                label="Close details"
                isIconOnly
                icon={<X size={15} />}
                variant="ghost"
                onClick={() => {
                  setShowDetails(false);
                  document
                    .querySelector<HTMLButtonElement>(
                      '[aria-label="Task details"]',
                    )
                    ?.focus();
                }}
              />
            </div>
            {result?.changes.length ? (
              <div className="evidence-files">
                {result.changes.map((change) => (
                  <button
                    key={change.path}
                    className="file-row"
                    title={change.path}
                    onClick={() => void openFile(change.path)}
                  >
                    <FileCode2 size={15} />
                    <span>{change.path}</span>
                    <small className="addition">+{change.additions}</small>
                    <small className="deletion">−{change.deletions}</small>
                  </button>
                ))}
              </div>
            ) : (
              <Text type="supporting">No changed files</Text>
            )}
            <Button
              label="Browse all files"
              icon={<FolderOpen size={14} />}
              variant="ghost"
              size="sm"
              isDisabled={!turns.length}
              onClick={() => {
                setShowDetails(false);
                setTab("files");
              }}
            />
            <details className="session-details">
              <summary>
                Session <ChevronRight size={12} aria-hidden="true" />
              </summary>
              <div>
                <Text type="supporting">
                  {task.provider === "codex" ? "Codex" : "Claude Code"} ·{" "}
                  {task.model || "Default model"}
                </Text>
                <Text type="supporting">
                  {turns.length} {turns.length === 1 ? "turn" : "turns"}
                </Text>
                {task.source && (
                  <Text type="supporting">
                    PR #{task.source.number} ·{" "}
                    {task.source.headCommit.slice(0, 8)}
                  </Text>
                )}
                {task.sessionId && (
                  <div className="session-identity">
                    <span>Session ID</span>
                    <CopyTextButton
                      text={task.sessionId}
                      label="Copy session ID"
                    />
                    <code>{task.sessionId}</code>
                  </div>
                )}
              </div>
            </details>
          </aside>
        )}
      </div>
      {linkPR && (
        <Modal
          title="Link pull request"
          onSubmit={() => void linkPullRequest()}
          onClose={() => setLinkPR(false)}
          footer={
            <>
              <Button label="Cancel" onClick={() => setLinkPR(false)} />
              <Button
                label="Link PR"
                variant="primary"
                isLoading={busy}
                isDisabled={!prURL.trim()}
                onClick={() => void linkPullRequest()}
              />
            </>
          }
        >
          {error && (
            <div role="alert" className="error-note">
              {error}
            </div>
          )}
          <TextInput
            label="Pull request URL"
            value={prURL}
            onChange={setPrURL}
            placeholder="https://github.com/owner/repo/pull/123"
            hasAutoFocus
          />
          <Text type="supporting">
            Uses {current?.name ?? "this machine"}’s GitHub connection.
          </Text>
        </Modal>
      )}
      {exported && (
        <Modal
          title="Project exported"
          width={480}
          onClose={() => setExported(null)}
          footer={
            <Button
              label={copied ? "Copied" : "Copy folder path"}
              onClick={() =>
                void navigator.clipboard
                  .writeText(exported)
                  .then(() => setCopied(true))
                  .catch(() => setError("Could not copy the path."))
              }
            />
          }
        >
          <p>
            Your project files are ready on {current?.name ?? "this machine"}.
          </p>
          <code style={{ overflowWrap: "anywhere" }}>{exported}</code>
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm === "apply"
              ? "Apply reviewed changes?"
              : confirm === "checkout"
                ? "Export project"
                : "Rename task"
          }
          onClose={() => setConfirm(null)}
          onSubmit={
            confirm === "rename" ? () => void finishConfirmation() : undefined
          }
          footer={
            <>
              <Button label="Cancel" onClick={() => setConfirm(null)} />
              <Button
                label={
                  confirm === "apply"
                    ? "Apply changes"
                    : confirm === "checkout"
                      ? "Export"
                      : "Save name"
                }
                variant="primary"
                isLoading={busy}
                isDisabled={busy || (confirm === "rename" && !title.trim())}
                onClick={() => void finishConfirmation()}
              />
            </>
          }
        >
          {error && (
            <div className="error-note" role="alert">
              {error}
            </div>
          )}
          {confirm === "rename" ? (
            <TextInput
              label="Task name"
              value={title}
              onChange={setTitle}
              hasAutoFocus
            />
          ) : confirm === "checkout" ? (
            <Text as="p">
              Create a separate copy of this turn’s code on{" "}
              {current?.name ?? "this machine"}, ready to open in your editor or
              run locally. Your project stays in place. Dependencies must be
              installed in the new folder.
            </Text>
          ) : (
            <>
              <Text as="p">
                Apply the patch from this reviewed turn to {project?.name}.
              </Text>
              <Text color="secondary">
                The project must be clean and still at the starting revision.
                This writes local files without committing or pushing them.
              </Text>
              <Text type="code">{project?.path}</Text>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
