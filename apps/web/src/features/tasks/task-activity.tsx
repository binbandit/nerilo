"use client";

import { useId, useState, type ReactNode } from "react";
import { CodeText } from "@/features/review/code-text";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  FileText,
  FilePenLine,
  Terminal,
} from "lucide-react";
import type { TaskEvent, TaskDetail } from "@nerilo/protocol";
import {
  activityPresentation,
  readableCommand,
  terminalText,
} from "@/features/tasks/activity-format";
import "@/features/tasks/task-activity.css";

function CopyOutput({
  value,
  label = "Copy raw output",
}: {
  value: string;
  label?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <button
      type="button"
      className="terminal-copy"
      aria-label={
        state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed. Try again"
            : label
      }
      title={label}
      onClick={() =>
        void navigator.clipboard
          .writeText(value)
          .then(() => setState("copied"))
          .catch(() => setState("failed"))
      }
    >
      {state === "copied" ? (
        <Check size={13} />
      ) : state === "failed" ? (
        <AlertCircle size={13} />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

export function TerminalOutput({
  command,
  output,
  raw = output,
  label = "Terminal",
}: {
  command?: string | null;
  output: string;
  raw?: string;
  label?: string;
}) {
  return (
    <div className="task-terminal">
      <div className="terminal-toolbar">
        {label === "Terminal" ? <Terminal size={13} /> : <FileText size={13} />}
        <span>{label}</span>
        <CopyOutput value={raw} />
      </div>
      {command && (
        <pre className="terminal-command">
          <span aria-hidden="true">$ </span>
          <CodeText text={command} language="bash" />
        </pre>
      )}
      {output ? (
        <pre
          className="terminal-output"
          tabIndex={0}
          aria-label="Terminal output"
        >
          {terminalText(output)}
        </pre>
      ) : (
        <div className="terminal-empty">No output</div>
      )}
    </div>
  );
}

export function ActivityEntry({
  event,
  showTime = false,
}: {
  event: TaskEvent;
  showTime?: boolean;
}) {
  const item = activityPresentation(event.text);
  const time = showTime && (
    <time dateTime={event.createdAt}>
      {new Date(event.createdAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </time>
  );
  if (item.kind === "notice") {
    return (
      <div className={`task-step task-step-notice ${event.kind}`}>
        {event.kind === "error" ? (
          <AlertCircle size={14} />
        ) : (
          <span className="step-notice-dot" aria-hidden="true" />
        )}
        <span className="task-step-notice-text">{item.label}</span>
        <CopyOutput value={event.text} />
        {time}
      </div>
    );
  }
  return (
    <details className={`task-step ${event.kind}`}>
      <summary>
        {item.kind === "command" ? (
          <Terminal size={14} />
        ) : item.kind === "files" ? (
          <FilePenLine size={14} />
        ) : event.kind === "error" ? (
          <AlertCircle size={14} />
        ) : (
          <FileText size={14} />
        )}
        {item.kind !== "command" && (
          <span className="task-step-label">{item.label}</span>
        )}
        {item.detail && (
          <span
            className={`task-step-detail ${item.kind === "files" || item.detail === item.command ? "code" : ""}`}
          >
            {item.detail === item.command ? (
              <CodeText text={item.detail} language="bash" />
            ) : (
              item.detail
            )}
          </span>
        )}
        <ChevronRight
          className="disclosure-chevron step-disclosure"
          size={12}
        />
        {time}
      </summary>
      <TerminalOutput
        command={item.command}
        output={item.output}
        raw={event.text}
        label={item.kind === "command" ? "Terminal" : "Details"}
      />
    </details>
  );
}

export function TurnActivity({
  children,
  events,
}: {
  children: ReactNode;
  events: TaskEvent[];
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className="turn-byline">
        {children}
        {events.length > 0 && (
          <button
            type="button"
            className="task-steps-trigger"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen(!open)}
          >
            {events.length} {events.length === 1 ? "step" : "steps"}
            <ChevronRight className="disclosure-chevron" size={13} />
          </button>
        )}
      </div>
      <div className="task-steps" id={id} hidden={!open}>
        {open &&
          events.map((event) => (
            <ActivityEntry key={event.seq} event={event} />
          ))}
      </div>
    </>
  );
}

type Verification = NonNullable<
  NonNullable<TaskDetail["turns"][number]["result"]>["verification"]
>;
export function VerificationOutput({
  verification,
  revision,
}: {
  verification: Verification;
  revision: string;
}) {
  const passed = verification.exitCode === 0;
  return (
    <details className={`task-verification ${passed ? "passed" : "failed"}`}>
      <summary>
        {passed ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        <span>Workspace verification {passed ? "passed" : "failed"}</span>
        <ChevronRight className="disclosure-chevron" size={13} />
        <code>
          <CodeText
            text={readableCommand(verification.command)}
            language="bash"
          />
        </code>
      </summary>
      <p className="verification-revision" title={revision}>
        Checked this turn’s workspace, including uncommitted files. Workspace
        HEAD {revision.slice(0, 8)}. GitHub checks for the published revision
        appear in the PR status.
      </p>
      <TerminalOutput
        command={readableCommand(verification.command)}
        output={verification.output}
        raw={`${verification.command}\n${verification.output}`}
      />
    </details>
  );
}
