"use client";
import { providerNames } from "@nerilo/protocol";

import dynamic from "next/dynamic";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import {
  activeStatuses,
  type Snapshot,
  type TaskDetail,
} from "@nerilo/protocol";
import {
  Activity,
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  Clock3,
  FileCode2,
  FolderGit2,
  FolderOpen,
  GitPullRequest,
  MoreHorizontal,
  PanelRight,
  Pause,
  Pencil,
  Play,
  Shield,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApiMutation } from "@/lib/use-api-mutation";
import { GithubIcon } from "@/components/ui/github-icon";
import { GithubAccountPicker } from "@/features/settings/github-account-picker";
import { AgentToolsPicker } from "@/components/composer/agent-tools-picker";
import { MessageComposer } from "@/components/composer/message-composer";
import { ModelPicker } from "@/components/composer/model-picker";
import { Modal } from "@/components/editors/editors";
import { Button, Heading, Text, TextInput } from "@/components/ui/ui";
import { useMachines } from "@/features/machines/machines";
import { focusComposer } from "@/features/navigation/keyboard";
import { PullRequests } from "@/features/review/pull-requests";
import { taskCanCompleteMergedPR } from "@/features/review/pull-request-status";
import { TaskGitActions } from "@/features/review/task-git-actions";
import { SandboxDialog } from "@/features/settings/sandbox-controls";
import {
  scheduledTime,
  SchedulePicker,
} from "@/features/tasks/schedule-picker";
import { ActivityEntry } from "@/features/tasks/task-activity";
import { TaskAutonomy } from "@/features/tasks/task-autonomy";
import { TaskChanges } from "@/features/tasks/task-changes";
import { TaskConversation } from "@/features/tasks/task-conversation";
import { TaskDetails } from "@/features/tasks/task-details";
import { TaskQueue } from "@/features/tasks/task-queue";
import { TaskRenameDialog } from "@/features/tasks/task-rename-dialog";

import { useCurrentTime } from "@/lib/use-current-time";
import { useDraft } from "@/lib/use-draft";

import "@/features/tasks/task-actions-menu.css";

const TaskFileBrowser = dynamic(
  () =>
    import("@/features/review/task-file-browser").then(
      (module) => module.TaskFileBrowser,
    ),
  { loading: () => <p role="status">Loading files…</p> },
);

export function TaskView({
  detail,
  data,
  onRestoreProject,
}: {
  detail: TaskDetail;
  data: Snapshot;

  onRestoreProject: () => void;
}) {
  const { mutateAsync: send } = useApiMutation(`task:${detail.task.id}`);
  const { task, turns, events } = detail;
  const [tab, setTab] = useState<
    "conversation" | "changes" | "activity" | "files"
  >("conversation");
  const [reviewTurnId, setReviewTurnId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const { current, currentId } = useMachines();
  const [prompt, setPrompt] = useDraft(`task:${task.id}`);
  const [scheduledAt, setScheduledAt] = useDraft(`task-schedule:${task.id}`);
  const [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<
    "rename" | { action: "apply" | "checkout"; turnId: string } | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [showGit, setShowGit] = useState(false);
  const [showSandbox, setShowSandbox] = useState(false);
  const [showGithub, setShowGithub] = useState(false);
  const taskActionsRef = useRef<HTMLButtonElement>(null);
  const closeGithub = () => {
    setShowGithub(false);
    requestAnimationFrame(() => taskActionsRef.current?.focus());
  };
  const [linkPR, setLinkPR] = useState(false);
  const [prURL, setPrURL] = useState("");
  const project = data.projects.find((p) => p.id === task.projectId);
  const latest = turns.at(-1);
  const result = latest?.result;
  const running = activeStatuses.includes(task.status);
  const providerReady = data.runtime.connections[task.provider].ready;
  const providerName = providerNames[task.provider];
  const confirmationChanged = Boolean(
    confirm &&
    confirm !== "rename" &&
    (confirm.turnId !== latest?.id || running),
  );
  const now = useCurrentTime(
    Boolean(scheduledAt) ||
      task.pending.some((input) => Boolean(input.scheduledAt)),
  );
  // A schedule restored from a draft may already have passed.
  const futureSchedule =
    scheduledAt && Date.parse(scheduledAt) > now ? scheduledAt : null;
  const nextScheduledAt =
    task.status === "queued" &&
    task.pending.length > 0 &&
    task.pending.every(
      (input) => input.scheduledAt && Date.parse(input.scheduledAt) > now,
    )
      ? task.pending.map((input) => input.scheduledAt!).sort()[0]
      : null;
  const latestResultTurn = turns.findLast((turn) => turn.result);
  const act = async (action: string, body: unknown = {}) => {
    if (actionPending.current) return false;
    actionPending.current = true;
    setBusy(true);
    setError("");
    try {
      await send({ path: `tasks/${task.id}/${action}`, body });
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
      confirm === "rename" ||
      confirmationChanged ||
      actionPending.current
    )
      return;
    if (confirm.action === "checkout") {
      actionPending.current = true;
      setBusy(true);
      setError("");
      try {
        const value: unknown = await send({
          path: `tasks/${task.id}/checkout`,
          body: {
            turnId: confirm.turnId,
          },
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
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Export failed.");
      } finally {
        actionPending.current = false;
        setBusy(false);
      }
      return;
    }
    if (await act(confirm.action, { turnId: confirm.turnId })) {
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
  const activity = events.filter((event) =>
    ["activity", "check", "error"].includes(event.kind),
  );
  const submit = async (value: string) => {
    if (busy || !value.trim()) return;
    // Send an expired draft schedule immediately rather than have it rejected.
    const schedule =
      scheduledAt && Date.parse(scheduledAt) > Date.now() ? scheduledAt : null;
    if (await act("follow-up", { text: value, scheduledAt: schedule })) {
      setPrompt("");
      setScheduledAt("");
    }
  };
  const openReview = useCallback(
    (turnId = reviewTurnId ?? latestResultTurn?.id) => {
      setReviewTurnId(turnId ?? null);
      setShowDetails(false);
      setShowGit(false);
      setTab("changes");
    },
    [reviewTurnId, latestResultTurn?.id],
  );
  const openFile = useCallback((path: string) => {
    setSelectedFile(path);
    setShowDetails(false);
    setTab("files");
  }, []);
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
          <PullRequests task={task} variant="header" />
          <span className={`task-state ${task.status}`}>
            {nextScheduledAt
              ? "Scheduled"
              : task.status === "check_failed"
                ? "Verification failed"
                : task.status === "ready"
                  ? "Ready for review"
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
              triggerLabel="Changes"
              open={showGit}
              inheritedGithubAccount={project?.githubAccount}
              onOpenChange={(open) => {
                setShowGit(open);
                if (open) setShowDetails(false);
              }}
              onViewDiff={() => openReview(latest?.id)}
            />
          )}
          {!project?.archived && (
            <TaskAutonomy task={task} base={project?.branch ?? "main"} />
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
            className="task-actions-menu"
            menuWidth={264}
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
                label: "Activity",
                icon: <Activity size={15} />,
                onClick: () => setTab("activity"),
              },
              { type: "divider" },
              {
                label: "Rename…",
                isDisabled: project?.archived,
                icon: <Pencil size={15} />,
                onClick: () => {
                  setError("");
                  setConfirm("rename");
                },
              },
              {
                label: "Link pull request…",
                isDisabled: project?.archived,
                icon: <GitPullRequest size={15} />,
                onClick: () => setLinkPR(true),
              },
              {
                label: "Export project…",
                icon: <FolderGit2 size={15} />,
                isDisabled: busy || running || !result || result.truncated,
                onClick: () => {
                  if (latest) {
                    setError("");
                    setConfirm({ action: "checkout", turnId: latest.id });
                  }
                },
              },
              {
                label: "Sandbox settings…",
                icon: <Shield size={15} />,
                isDisabled: project?.archived,
                onClick: () => {
                  taskActionsRef.current?.focus();
                  setShowSandbox(true);
                },
              },
              {
                label: `GitHub account: ${task.githubAccount ? `@${task.githubAccount.login}` : project?.githubAccount ? `@${project.githubAccount.login} (project)` : "Machine default"}…`,
                icon: <GithubIcon size={15} />,
                isDisabled:
                  busy || Boolean(task.activeTurnId) || project?.archived,
                onClick: () => {
                  setError("");
                  setShowGithub(true);
                },
              },
              { type: "divider" },
              {
                label: "Mark complete",
                icon: <Check size={15} />,
                isDisabled:
                  busy ||
                  project?.archived ||
                  !["ready", "check_failed"].includes(task.status),
                onClick: () => void act("complete"),
              },
              {
                label: task.archived ? "Restore" : "Archive",
                icon: task.archived ? (
                  <ArchiveRestore size={15} />
                ) : (
                  <Archive size={15} />
                ),
                isDisabled: running || busy,
                onClick: () =>
                  void act("archive", { archived: !task.archived }),
              },
            ]}
          />
        </div>
      </header>
      {!project?.archived && taskCanCompleteMergedPR(task) && (
        <div className="task-merged-notice">
          <Text>
            {task.pullRequests
              .filter((pr) => pr.state === "merged")
              .map((pr) => `PR #${pr.number}`)
              .join(", ")}{" "}
            merged. Mark this task complete when its remaining work is finished.
          </Text>
          <Button
            label="Mark complete"
            size="sm"
            icon={<Check size={14} />}
            isDisabled={busy}
            onClick={() => void act("complete")}
          />
        </div>
      )}
      {showSandbox && !project?.archived && (
        <SandboxDialog
          task={task}
          defaults={data.settings.sandbox}
          onClose={() => {
            setShowSandbox(false);
            requestAnimationFrame(() => taskActionsRef.current?.focus());
          }}
        />
      )}
      {showGithub && (
        <Modal
          title="Task GitHub account"
          onClose={() => {
            if (!busy) closeGithub();
          }}
        >
          <Text type="supporting">
            Choose an account for this task’s GitHub actions. Other tasks and
            the machine’s active login are unaffected.
          </Text>
          <GithubAccountPicker
            scope="task"
            value={task.githubAccount}
            inherited={project?.githubAccount}
            disabled={busy}
            onChange={async (githubAccount) => {
              if (await act("github-account", { githubAccount })) closeGithub();
            }}
          />
          {error && (
            <p className="error-note" role="alert">
              {error}
            </p>
          )}
        </Modal>
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
            {!providerReady && (
              <Button
                label="Open connections"
                size="sm"
                variant="ghost"
                href="#settings/connections"
              />
            )}
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
            <TaskConversation
              detail={detail}
              running={running}
              openFile={openFile}
              openReview={openReview}
            />
          ) : tab === "files" ? (
            <TaskFileBrowser
              taskId={task.id}
              revision={`${latest?.id ?? ""}:${latest?.status ?? ""}`}
              changes={result?.changes ?? []}
              diff={result?.diff ?? ""}
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
              {activity.length ? (
                activity.map((event) => (
                  <ActivityEntry key={event.seq} event={event} showTime />
                ))
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
            <TaskChanges
              detail={detail}
              project={project}
              running={running}
              reviewTurnId={reviewTurnId}
              onSelectTurn={openReview}
              onConfirm={(action, turnId) => {
                setError("");
                setConfirm({ action, turnId });
              }}
              onSend={async (text, commentCount) => {
                const sent = await act("follow-up", {
                  text,
                  requestOrigin: { kind: "review", commentCount },
                });
                if (sent) setTab("conversation");
                return sent;
              }}
            />
          )}
          {tab !== "changes" && (
            <TaskQueue
              now={now}
              key={task.id}
              readOnly={project?.archived}
              task={task}
              onUseAsFollowUp={(text) =>
                setPrompt(prompt ? `${prompt}\n\n${text}` : text)
              }
            />
          )}
          {tab !== "changes" && !task.archived && !project?.archived && (
            <div className="follow-up" data-keyboard-region="composer">
              {!providerReady && !task.error && (
                <div className="task-connection-notice" role="status">
                  <span>
                    {providerName} needs a connection before the next turn can
                    run. Your draft is saved.
                  </span>
                  <Button
                    label="Open connections"
                    size="sm"
                    variant="ghost"
                    href="#settings/connections"
                  />
                </div>
              )}
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
                      connections={data.runtime.connections}
                      value={{
                        provider: task.provider,
                        model: task.model,
                        effort: task.effort,
                      }}
                      running={running}
                      onChange={async (execution) => {
                        await send({
                          path: `tasks/${task.id}/execution`,
                          body: execution,
                        });
                      }}
                    />
                    <AgentToolsPicker
                      key={task.id}
                      skills={data.settings.skills}
                      servers={data.settings.mcpServers}
                      value={task.tools}
                      running={running}
                      onChange={async (tools) => {
                        await send({
                          path: `tasks/${task.id}/tools`,
                          body: tools,
                        });
                      }}
                    />
                    <SchedulePicker
                      value={futureSchedule}
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
          <TaskDetails
            detail={detail}
            openFile={openFile}
            onClose={() => setShowDetails(false)}
            onBrowseFiles={() => {
              setShowDetails(false);
              setTab("files");
            }}
          />
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
      {confirm === "rename" ? (
        <TaskRenameDialog
          key={task.id}
          taskId={task.id}
          currentTitle={task.title}
          suggestedTitle={result?.metadata?.title}
          canSuggest={!running && !!result && !project?.archived}
          busy={busy}
          error={error}
          onSave={(title) => act("rename", { title })}
          onClose={() => {
            setConfirm(null);
            setError("");
            requestAnimationFrame(() => taskActionsRef.current?.focus());
          }}
        />
      ) : confirm ? (
        <Modal
          title={
            confirm.action === "apply"
              ? "Apply reviewed changes?"
              : "Export project"
          }
          onClose={() => setConfirm(null)}
          footer={
            <>
              <Button label="Cancel" onClick={() => setConfirm(null)} />
              <Button
                label={confirm.action === "apply" ? "Apply changes" : "Export"}
                variant="primary"
                isLoading={busy}
                isDisabled={busy || confirmationChanged}
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
          {confirmationChanged && (
            <div className="error-note" role="alert">
              This task has newer work. Close this dialog and review its latest
              result before continuing.
            </div>
          )}
          {confirm.action === "checkout" ? (
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
      ) : null}
    </div>
  );
}
