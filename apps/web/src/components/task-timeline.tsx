"use client";
import type { ReactNode } from "react";
import {
  Check,
  ChevronRight,
  Circle,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  MessageSquare,
  Upload,
  X,
  ExternalLink,
} from "lucide-react";
import {
  type RepositoryEvent,
  type TaskEvent,
  type Turn,
  type Provider,
} from "@nerilo/protocol";
import { taskTimeline } from "@/lib/task-timeline";
import { ProviderIcon } from "@/components/provider-icon";
import { relativeTime } from "@/components/ui";
import { terminalText } from "@/lib/activity-format";
import "./task-timeline.css";

function safeLink(value: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}
function EventIcon({ event }: { event: RepositoryEvent }) {
  const icon =
    event.kind === "feedback" || event.kind === "review"
      ? MessageSquare
      : event.kind === "ci"
        ? event.status === "passing"
          ? Check
          : event.status === "failing"
            ? X
            : Circle
        : event.kind === "merged"
          ? GitMerge
          : event.kind === "base-update" || event.kind === "branch"
            ? GitBranch
            : event.kind === "published"
              ? Upload
              : event.kind === "commit"
                ? GitCommitHorizontal
                : GitPullRequest;
  const Icon = icon;
  return <Icon size={14} />;
}
function RepositoryRow({ event }: { event: RepositoryEvent }) {
  const url = safeLink(event.url ?? event.prUrl);
  const description = (
    <>
      <strong>{event.actor}</strong>
      {event.actor ? " " : ""}
      {event.summary}
    </>
  );
  return (
    <div className={`repo-timeline-event ${event.kind} ${event.status ?? ""}`}>
      <span className="repo-timeline-node" aria-hidden="true">
        <EventIcon event={event} />
      </span>
      <div className="repo-timeline-content">
        {event.body ? (
          <details className="repo-timeline-detail">
            <summary>
              <span className="repo-timeline-summary-line">
                {description}
                <ChevronRight
                  className="repo-timeline-chevron"
                  size={12}
                  aria-hidden="true"
                />
              </span>
              <span className="repo-timeline-preview">
                {terminalText(event.body).replace(/\s+/g, " ")}
              </span>
            </summary>
            <p>{terminalText(event.body)}</p>
            {url && (
              <a href={url} target="_blank" rel="noreferrer">
                View on GitHub <ExternalLink size={11} />
              </a>
            )}
          </details>
        ) : (
          <span className="repo-timeline-label">
            {description}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                aria-label={`${event.summary} on GitHub`}
              >
                <ExternalLink size={11} />
              </a>
            )}
          </span>
        )}
      </div>
      <time
        dateTime={event.occurredAt}
        title={`${event.timeSource === "observed" ? "Observed " : ""}${new Date(event.occurredAt).toLocaleString()}`}
      >
        {relativeTime(event.occurredAt)}
      </time>
    </div>
  );
}
export function TaskTimeline({
  turns,
  events,
  renderTurn,
  provider,
}: {
  turns: Turn[];
  events: TaskEvent[];
  renderTurn: (turn: Turn, index: number) => ReactNode;
  provider: Provider;
}) {
  return (
    <div className="task-timeline" aria-label="Task history">
      {taskTimeline(turns, events).map((item) =>
        item.kind === "turn" ? (
          <div className="repo-timeline-turn" key={item.id}>
            <span
              className="repo-timeline-node repo-timeline-agent"
              role="img"
              aria-label={`${(item.turn.execution?.provider ?? provider) === "claude" ? "Claude" : "Codex"} turn`}
            >
              <ProviderIcon
                provider={item.turn.execution?.provider ?? provider}
              />
            </span>
            {renderTurn(item.turn, item.index)}
          </div>
        ) : (
          <RepositoryRow key={item.id} event={item.event} />
        ),
      )}
    </div>
  );
}
