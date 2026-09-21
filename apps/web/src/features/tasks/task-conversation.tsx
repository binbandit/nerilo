"use client";
import { providerNames } from "@nerilo/protocol";

import {
  requestLabel,
  type Task,
  type TaskDetail,
  type TaskEvent,
  type Turn,
} from "@nerilo/protocol";
import { ChevronRight, FileCode2 } from "lucide-react";
import { memo, useMemo } from "react";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Button, relativeTime, Text } from "@/components/ui/ui";
import {
  TurnActivity,
  VerificationOutput,
} from "@/features/tasks/task-activity";
import { TaskMarkdown } from "@/features/tasks/task-markdown";
import { activitySummary } from "@/features/tasks/activity-format";
import { TaskStateSummary } from "@/features/tasks/task-state-summary";
import { TaskTimeline } from "@/features/tasks/task-timeline";
import {
  PullRequestStatus,
  PullRequestSignal,
} from "@/features/review/pull-requests";

import "@/features/tasks/turn-instructions.css";

export const TaskConversation = memo(function TaskConversation({
  detail,
  running,
  openFile,
  openReview,
}: {
  detail: TaskDetail;
  running: boolean;
  openFile: (path: string) => void;
  openReview: (turnId: string) => void;
}) {
  const { task, turns, events } = detail;
  const eventsByTurn = useMemo(() => {
    const grouped = new Map<string, TaskEvent[]>();
    for (const event of events) {
      if (!event.turnId) continue;
      const group = grouped.get(event.turnId);
      if (group) group.push(event);
      else grouped.set(event.turnId, [event]);
    }
    return grouped;
  }, [events]);
  return (
    <div className="conversation-history">
      {task.source?.previousTaskId && (
        <p className="task-workspace-context">
          Started from an updated PR snapshot.{" "}
          <a href={`#task/${task.source.previousTaskId}`}>Previous workspace</a>{" "}
          retains its history and files.
        </p>
      )}
      <TaskStateSummary
        taskId={task.id}
        turnId={turns.at(-1)?.id}
        status={task.status}
      />
      <TaskTimeline
        turns={turns}
        events={events}
        provider={task.provider}
        renderTurn={(turn, index) => (
          <ConversationTurn
            task={task}
            turn={turn}
            turnEvents={eventsByTurn.get(turn.id) ?? []}
            current={index === turns.length - 1}
            running={running}
            openFile={openFile}
            openReview={openReview}
          />
        )}
      />
      {task.pullRequests.length > 0 && (
        <section
          className="task-current-prs"
          aria-label="Current pull request status"
        >
          <h2>Current pull request status</h2>
          {task.pullRequests.map((pr) => (
            <div key={pr.url} className="task-current-pr">
              <a href={pr.url} target="_blank" rel="noreferrer">
                <PullRequestSignal pr={pr} />
                <strong>
                  #{pr.number} {pr.title}
                </strong>
                {(pr.state === "merged" || pr.state === "closed") && (
                  <span>{pr.state === "merged" ? "Merged" : "Closed"}</span>
                )}
              </a>
              <PullRequestStatus pr={pr} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
});

function ConversationTurn({
  task,
  turn,
  turnEvents,
  current,
  running,
  openFile,
  openReview,
}: {
  task: Task;
  turn: Turn;
  turnEvents: TaskEvent[];
  current: boolean;
  running: boolean;
  openFile: (path: string) => void;
  openReview: (turnId: string) => void;
}) {
  const activity = turnEvents.filter(
    (e) => e.kind === "activity" || e.kind === "check" || e.kind === "error",
  );
  const provider =
    turn.execution?.provider ?? task.sessionProvider ?? task.provider;
  const response =
    turn.result?.summary ||
    turnEvents.findLast((e) => e.kind === "assistant")?.text;
  const automaticRequest = requestLabel(turn.prompt, turn.requestOrigin);
  const activeEvent =
    current && running
      ? turnEvents.findLast((event) => event.kind === "activity")
      : undefined;
  return (
    <details
      className="turn-card"
      key={turn.id}
      open={current ? true : undefined}
    >
      <summary className="turn-request">
        <span className="turn-prompt">
          {!automaticRequest && turn.result?.metadata?.promptSummary && (
            <span className="turn-prompt-short">
              {turn.result.metadata.promptSummary}
            </span>
          )}
          <span className="turn-prompt-full">
            {automaticRequest ?? turn.prompt}
          </span>
        </span>
        <CopyTextButton text={turn.prompt} label="Copy prompt" />
        <time dateTime={turn.startedAt}>{relativeTime(turn.startedAt)}</time>
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
            <pre tabIndex={0} aria-label="Full agent instructions">
              {turn.prompt}
            </pre>
          </details>
        )}
        <TurnActivity events={activity}>
          <ProviderIcon provider={provider} />
          <Text type="supporting">
            {providerNames[provider]}
            {turn.execution?.model ? ` · ${turn.execution.model}` : ""}
          </Text>
        </TurnActivity>
        {response && (
          <>
            <p className="turn-report-label">
              Agent report
              {turn.endedAt
                ? ` · ${relativeTime(turn.endedAt).toLowerCase()}`
                : ""}
              {turn.result?.headCommit && (
                <span title={turn.result.headCommit}>
                  {" "}
                  · workspace HEAD {turn.result.headCommit.slice(0, 8)}
                </span>
              )}
            </p>
            <div className="prose">
              <TaskMarkdown text={response} onOpenFile={openFile} />
            </div>
          </>
        )}
        {response && (
          <div className="response-copy-actions">
            <CopyTextButton text={response} label="Copy response" />
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
                : activeEvent
                  ? activitySummary(activeEvent.text)
                  : "Preparing…"}
            </Text>
          </div>
        )}
        {turn.result?.verification && (
          <VerificationOutput
            verification={turn.result.verification}
            revision={turn.result.headCommit}
          />
        )}
      </div>
    </details>
  );
}
