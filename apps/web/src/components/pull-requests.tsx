"use client";
import { useId, useState } from "react";
import { Popover, DropdownMenu } from "@astryxdesign/core";
import {
  Check,
  Circle,
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  GitPullRequestDraft,
  CircleCheck,
  CircleX,
  AlertTriangle,
  RefreshCw,
  MoreHorizontal,
  Unlink,
  X,
} from "lucide-react";
import type { PullRequest, Task } from "@nerilo/protocol";
import { relativeTime } from "@/components/ui";
import { mutate } from "@/lib/api";
import { CopyTextButton } from "@/components/copy-text-button";
import "./pull-requests.css";

export function PullRequestSignal({ pr }: { pr: PullRequest }) {
  if (pr.state === "merged") return <GitMerge size={14} />;
  if (pr.state === "closed") return <GitPullRequestClosed size={14} />;
  if (pr.state === "draft") return <GitPullRequestDraft size={14} />;
  return <GitPullRequest size={14} />;
}
function ReviewAndChecks({ pr }: { pr: PullRequest }) {
  if (pr.state === "merged" || pr.state === "closed") return null;
  return (
    <>
      {pr.review === "approved" && (
        <span className="pr-signal approved" title={reviewLabels[pr.review]}>
          <Check size={13} />
        </span>
      )}
      {pr.review === "changes_requested" && (
        <span
          className="pr-signal changes_requested"
          title={reviewLabels[pr.review]}
        >
          <X size={13} />
        </span>
      )}
      {pr.checks !== "none" && (
        <span
          className={`pr-signal ${pr.checks}`}
          title={checkLabels[pr.checks]}
        >
          {pr.checks === "passing" ? (
            <CircleCheck size={13} />
          ) : pr.checks === "failing" ? (
            <CircleX size={13} />
          ) : (
            <span className="pr-pending" />
          )}
        </span>
      )}
      {pr.conflicts && (
        <span className="pr-signal failing" title="Merge conflicts">
          <AlertTriangle size={13} />
        </span>
      )}
    </>
  );
}
export const reviewLabels = {
  approved: "Approved",
  changes_requested: "Changes requested",
  required: "Review required",
  none: "No review decision",
};
export const checkLabels = {
  passing: "Checks passed",
  failing: "Checks failing",
  pending: "Checks running",
  none: "No checks",
};
export function PullRequests({
  task,
  onUpdate,
  variant = "sidebar",
}: {
  task: Task;
  onUpdate: () => void;
  variant?: "sidebar" | "header";
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const act = async (url: string, remove = false) => {
    setBusy(true);
    setError("");
    try {
      await mutate(`tasks/${task.id}/pull-requests`, { url, remove });
      onUpdate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  if (!task.pullRequests.length) return null;
  const activePRs = task.pullRequests.filter(
    (pr) => pr.state === "open" || pr.state === "draft",
  );
  const primary =
    activePRs.find((pr) => pr.review === "changes_requested" || pr.conflicts) ??
    activePRs.find((pr) => pr.checks === "failing") ??
    activePRs.find((pr) => pr.checks === "pending") ??
    task.pullRequests.find(
      (pr) => pr.state === "open" || pr.state === "draft",
    ) ??
    task.pullRequests[0];
  const terminal = primary.state === "merged" || primary.state === "closed";
  const label = `PR #${primary.number}: ${primary.state}${terminal ? "" : `, ${reviewLabels[primary.review]}, ${checkLabels[primary.checks]}${primary.conflicts ? ", merge conflicts" : ""}`}${primary.error ? ", update unavailable" : ""}${task.pullRequests.length > 1 ? `; ${task.pullRequests.length} linked pull requests` : ""}`;
  const showState =
    variant === "header" ||
    terminal ||
    primary.state === "draft" ||
    (primary.review !== "approved" &&
      primary.review !== "changes_requested" &&
      primary.checks === "none" &&
      !primary.conflicts);
  return (
    <Popover
      label="Pull requests"
      placement={variant === "header" ? "below" : "end"}
      alignment={variant === "header" ? "end" : "start"}
      width={420}
      className="pr-peek-popover"
      style={{ padding: 4, borderRadius: 8 }}
      content={
        <div className="pr-peek-list">
          {error && (
            <p className="pr-error" role="alert">
              {error}
            </p>
          )}
          {task.pullRequests.map((pr) => (
            <PullRequestRow key={pr.url} pr={pr} busy={busy} act={act} />
          ))}
        </div>
      }
    >
      <button
        className={`pr-sidebar-signal pr-trigger pr-trigger-${variant} ${primary.error ? "stale" : ""}`}
        aria-label={label}
        title={label}
      >
        {showState && (
          <span className={`pr-signal ${primary.state}`} aria-hidden="true">
            <PullRequestSignal pr={primary} />
          </span>
        )}
        {variant === "header" && (
          <span className="pr-number">#{primary.number}</span>
        )}
        <span className="pr-signals" aria-hidden="true">
          <ReviewAndChecks pr={primary} />
        </span>
        {task.pullRequests.length > 1 && (
          <span className="pr-extra-count">
            +{task.pullRequests.length - 1}
          </span>
        )}
      </button>
    </Popover>
  );
}

function PullRequestRow({
  pr,
  busy,
  act,
}: {
  pr: PullRequest;
  busy: boolean;
  act: (url: string, remove?: boolean) => Promise<void>;
}) {
  const [checksOpen, setChecksOpen] = useState(false);
  const checksId = useId();
  const terminal = pr.state === "merged" || pr.state === "closed";
  const status = terminal
    ? pr.state === "merged"
      ? "Merged"
      : "Closed"
    : pr.conflicts
      ? "Conflicts"
      : pr.review === "changes_requested"
        ? "Changes requested"
        : pr.review === "approved"
          ? "Approved"
          : pr.state === "draft"
            ? "Draft"
            : pr.review === "required"
              ? "Review required"
              : "Open";
  const tone = terminal
    ? pr.state
    : pr.conflicts
      ? "failing"
      : pr.review !== "none"
        ? pr.review
        : pr.state;
  const detail = `${pr.repository} #${pr.number}: ${pr.title}. ${status}${terminal ? "" : `, ${checkLabels[pr.checks]}`}`;
  return (
    <div className="pr-peek-entry">
      <div className="pr-peek-row">
        <a
          className="pr-peek-link"
          href={pr.url}
          target="_blank"
          rel="noreferrer"
          aria-label={detail}
          title={`${pr.repository} #${pr.number}
${pr.title}`}
        >
          <span className={`pr-peek-number pr-signal ${pr.state}`}>
            <PullRequestSignal pr={pr} />
            <span>{pr.number}</span>
          </span>
          <span className="pr-peek-title">{pr.title || pr.repository}</span>
        </a>
        <span className={`pr-peek-status pr-tone ${tone}`}>{status}</span>
        {!terminal && pr.checkRuns.length > 0 ? (
          <button
            type="button"
            className={`pr-peek-check-toggle pr-signal ${pr.checks}`}
            aria-label={`${checkLabels[pr.checks]} for PR ${pr.number}`}
            aria-expanded={checksOpen}
            aria-controls={checksId}
            title={`${checksOpen ? "Hide" : "Show"} checks`}
            onClick={() => setChecksOpen((open) => !open)}
          >
            <CheckSignal state={pr.checks} />
          </button>
        ) : !terminal && pr.checks !== "none" ? (
          <span
            className={`pr-signal ${pr.checks}`}
            role="img"
            aria-label={checkLabels[pr.checks]}
            title={checkLabels[pr.checks]}
          >
            <CheckSignal state={pr.checks} />
          </span>
        ) : null}
        {pr.error && (
          <span
            className="pr-signal failing"
            role="img"
            aria-label="PR update unavailable"
            title="Update unavailable"
          >
            <AlertTriangle size={13} />
          </span>
        )}
        <CopyTextButton text={pr.url} label={`Copy PR ${pr.number} link`} />
        <DropdownMenu
          alignment="end"
          menuWidth={180}
          hasChevron={false}
          button={{
            label: `PR ${pr.number} actions`,
            isIconOnly: true,
            variant: "ghost",
            size: "sm",
            icon: <MoreHorizontal size={14} />,
            className: "pr-peek-actions",
          }}
          items={[
            {
              label: "Refresh status",
              icon: <RefreshCw size={13} />,
              isDisabled: busy,
              onClick: () => void act(pr.url),
            },
            {
              label: "Unlink pull request",
              icon: <Unlink size={13} />,
              isDisabled: busy,
              onClick: () => void act(pr.url, true),
            },
          ]}
        />
      </div>
      {checksOpen && !terminal && (
        <div
          className="pr-peek-checks"
          id={checksId}
          role="list"
          aria-label={`Checks for PR ${pr.number}`}
        >
          {pr.checkRuns.map((check, index) => (
            <div
              className={`pr-tone ${check.state}`}
              key={`${check.name}:${index}`}
              role="listitem"
              aria-label={`${check.name}: ${checkLabels[check.state]}`}
            >
              {check.state === "passing" ? (
                <Check size={12} />
              ) : check.state === "failing" ? (
                <X size={12} />
              ) : (
                <Circle size={10} />
              )}
              <span>{check.name}</span>
            </div>
          ))}
          <span className="pr-peek-updated">
            {pr.error
              ? "Update unavailable"
              : `Updated ${relativeTime(pr.syncedAt).toLowerCase()}`}
          </span>
        </div>
      )}
    </div>
  );
}

function CheckSignal({ state }: { state: PullRequest["checks"] }) {
  if (state === "passing") return <CircleCheck size={13} />;
  if (state === "failing") return <CircleX size={13} />;
  if (state === "pending") return <span className="pr-pending" />;
  return <Circle size={13} />;
}
