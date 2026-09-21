"use client";
import { providerNames } from "@nerilo/protocol";
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
import {
  groupTimeline,
  taskTimeline,
  type TimelineGroup,
} from "@/features/tasks/timeline-model";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { relativeTime } from "@/components/ui/ui";
import { terminalText } from "@/features/tasks/activity-format";
import "@/features/tasks/task-timeline.css";

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
                {event.kind === "ci" && <span>GitHub checks: </span>}
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
            {event.kind === "ci" && <span>GitHub checks: </span>}
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
        <EventRevision event={event} />
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
function EventRevision({ event }: { event: RepositoryEvent }) {
  if (
    !event.headSha &&
    !event.baseSha &&
    !event.observedHeadSha &&
    !event.observedBaseSha
  )
    return null;
  const observedTime = event.observedAt
    ? ` · Observed ${new Date(event.observedAt).toLocaleString()}`
    : "";
  return (
    <small className="repo-timeline-revision">
      {event.headSha && (
        <span title={event.headSha}>
          {event.kind === "review" || event.kind === "feedback"
            ? "Reviewed revision"
            : event.kind === "ci"
              ? "Checked revision"
              : event.kind === "commit" || event.kind === "branch"
                ? "Local revision"
                : "Published revision"}{" "}
          {event.headSha.slice(0, 8)}
        </span>
      )}
      {event.baseSha && (
        <span title={event.baseSha}>Base {event.baseSha.slice(0, 8)}</span>
      )}
      {event.observedHeadSha && event.observedHeadSha !== event.headSha && (
        <span title={`${event.observedHeadSha}${observedTime}`}>
          Head when observed {event.observedHeadSha.slice(0, 8)}
        </span>
      )}
      {event.observedBaseSha && event.observedBaseSha !== event.baseSha && (
        <span title={`${event.observedBaseSha}${observedTime}`}>
          Base when observed {event.observedBaseSha.slice(0, 8)}
        </span>
      )}
    </small>
  );
}

function RepositoryGroup({ item }: { item: TimelineGroup }) {
  const latest = item.events.at(-1)!;
  const review = item.events.find((event) => event.kind === "review");
  const feedbackCount = item.events.filter(
    (event) => event.kind === "feedback",
  ).length;
  const title =
    item.group === "base-update"
      ? `${latest.summary} · observed ${item.events.length} times`
      : `Review activity · ${latest.actor}${review ? ` ${review.summary}` : ""} · ${feedbackCount} feedback ${feedbackCount === 1 ? "item" : "items"}`;
  return (
    <div
      className={`repo-timeline-event ${latest.kind} ${review?.status ?? latest.status ?? ""}`}
    >
      <span className="repo-timeline-node" aria-hidden="true">
        <EventIcon event={review ?? latest} />
      </span>
      <details className="repo-timeline-content repo-timeline-detail repo-timeline-group">
        <summary>
          <span className="repo-timeline-summary-line">
            {title}
            <ChevronRight
              className="repo-timeline-chevron"
              size={12}
              aria-hidden="true"
            />
          </span>
          <EventRevision event={latest} />
        </summary>
        {item.events.map((event) => (
          <div className="repo-timeline-group-entry" key={event.id}>
            <strong>
              {event.actor ? `${event.actor} ` : ""}
              {event.summary}
            </strong>
            <time dateTime={event.occurredAt}>
              {new Date(event.occurredAt).toLocaleString()}
            </time>
            <EventRevision event={event} />
            {event.body && <p>{terminalText(event.body)}</p>}
            {safeLink(event.url ?? event.prUrl) && (
              <a
                href={safeLink(event.url ?? event.prUrl)}
                target="_blank"
                rel="noreferrer"
              >
                View on GitHub <ExternalLink size={11} />
              </a>
            )}
          </div>
        ))}
      </details>
      <time
        dateTime={latest.occurredAt}
        title={new Date(latest.occurredAt).toLocaleString()}
      >
        {relativeTime(latest.occurredAt)}
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
      {groupTimeline(taskTimeline(turns, events)).map((item) =>
        item.kind === "turn" ? (
          <div className="repo-timeline-turn" key={item.id}>
            <span
              className="repo-timeline-node repo-timeline-agent"
              role="img"
              aria-label={`${providerNames[item.turn.execution?.provider ?? provider]} turn`}
            >
              <ProviderIcon
                provider={item.turn.execution?.provider ?? provider}
              />
            </span>
            {renderTurn(item.turn, item.index)}
          </div>
        ) : item.kind === "repository-group" ? (
          <RepositoryGroup key={item.id} item={item} />
        ) : (
          <RepositoryRow key={item.id} event={item.event} />
        ),
      )}
    </div>
  );
}
