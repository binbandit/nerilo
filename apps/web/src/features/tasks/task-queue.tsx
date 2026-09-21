"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUpToLine,
  ChevronRight,
  GripVertical,
  Pencil,
  X,
} from "lucide-react";
import {
  requestLabel,
  matchesShortcut,
  effectiveBindings,
  formatShortcut,
  ariaShortcut,
  type Task,
} from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Button, TextArea } from "@/components/ui/ui";

import {
  SchedulePicker,
  scheduledTime,
} from "@/features/tasks/schedule-picker";
import { useSubmitFromField } from "@/lib/form-keyboard";
import { focusComposer } from "@/features/navigation/keyboard";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/features/navigation/shortcut-preferences";
import "@/features/tasks/task-queue.css";

type Input = Task["pending"][number];
export function TaskQueue({
  now,
  task,
  onUseAsFollowUp,
  readOnly = false,
}: {
  now: number;
  task: Task;
  readOnly?: boolean;

  onUseAsFollowUp: (text: string) => void;
}) {
  const { mutateAsync: send } = useApiMutation(`task:${task.id}`);
  const submitFromField = useSubmitFromField();
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  const shortcuts = effectiveBindings(bindings);
  const reorderChords = [
    ...shortcuts["reorder-up"],
    ...shortcuts["reorder-down"],
  ];
  const [editing, setEditing] = useState<Input | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const dragging = useRef<string | null>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const editFocus = useRef<string | null>(null);
  const restoreFocus = useRef<{
    id: string;
    overId: string;
    edge: "before" | "after";
  } | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    edge: "before" | "after";
  } | null>(null);
  const stillQueued = task.pending.some((input) => input.id === editing?.id);
  useEffect(() => {
    if (editing || busy || !editFocus.current) return;
    const target =
      editButtons.current.get(editFocus.current) ??
      handles.current.values().next().value;
    if (target) target.focus();
    else focusComposer();
    editFocus.current = null;
  }, [editing, busy, task.pending]);
  function cancelEdit() {
    if (busy) return;
    setEditing(null);
    setError("");
  }
  function saveEdit() {
    if (
      !editing ||
      !stillQueued ||
      busy ||
      task.archived ||
      readOnly ||
      !draft.trim() ||
      draft.trim().length > 30000
    )
      return;
    void update(
      {
        action: "edit",
        inputId: editing.id,
        text: draft,
        expectedText: editing.text,
      },
      "Queued message updated.",
    );
  }
  useEffect(() => {
    const target = restoreFocus.current;
    if (!target || busy) return;
    const index = task.pending.findIndex((input) => input.id === target.id);
    const overIndex = task.pending.findIndex(
      (input) => input.id === target.overId,
    );
    if (index < 0 || overIndex < 0) {
      restoreFocus.current = null;
      return;
    }
    if (target.edge === "before" ? index < overIndex : index > overIndex) {
      handles.current.get(target.id)?.focus();
      restoreFocus.current = null;
    }
  }, [task.pending, busy]);
  async function update(body: unknown, message: string, rethrow = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await send({ path: `tasks/${task.id}/queue`, body });
      setNotice(message);
      setEditing(null);
    } catch (reason) {
      restoreFocus.current = null;
      if (rethrow) throw reason;
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update the queue.",
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  if (!task.pending.length && !editing && !error) return null;
  return (
    <section className="task-queue" aria-label="Queued messages">
      <div className="task-queue-heading">
        {task.pending.length > 0 &&
        task.pending.every(
          (input) => input.scheduledAt && Date.parse(input.scheduledAt) > now,
        )
          ? "Scheduled"
          : "Next up"}{" "}
        <span>{task.pending.length}</span>
      </div>
      {task.pending.map((input, index) => (
        <div
          className="task-queue-row"
          key={input.id}
          data-drop={drop?.id === input.id ? drop.edge : undefined}
          onDragOver={(event) => {
            if (!dragging.current || dragging.current === input.id || busy)
              return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const bounds = event.currentTarget.getBoundingClientRect();
            setDrop({
              id: input.id,
              edge:
                event.clientY < bounds.top + bounds.height / 2
                  ? "before"
                  : "after",
            });
          }}
          onDrop={(event) => {
            event.preventDefault();
            const inputId = dragging.current;
            dragging.current = null;
            setDrop(null);
            if (inputId && inputId !== input.id) {
              const bounds = event.currentTarget.getBoundingClientRect();
              void update(
                {
                  action: "reorder",
                  inputId,
                  overId: input.id,
                  edge:
                    event.clientY < bounds.top + bounds.height / 2
                      ? "before"
                      : "after",
                },
                "Queue reordered.",
              );
            }
          }}
        >
          <button
            type="button"
            className="task-queue-drag"
            ref={(element) => {
              if (element) handles.current.set(input.id, element);
              else handles.current.delete(input.id);
            }}
            aria-label={`Reorder queued message ${index + 1}`}
            aria-keyshortcuts={
              reorderChords
                .map((chord) => ariaShortcut(chord, mac))
                .join(" ") || undefined
            }
            title={[
              "Drag to reorder",
              ...reorderChords.map((chord) => formatShortcut(chord, mac)),
            ].join(" · ")}
            disabled={busy || task.archived || readOnly || Boolean(editing)}
            draggable={!busy && !task.archived && !readOnly && !editing}
            onDragStart={(event) => {
              dragging.current = input.id;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/nerilo-queue", input.id);
            }}
            onDragEnd={() => {
              dragging.current = null;
              setDrop(null);
            }}
            onKeyDown={(event) => {
              if (event.defaultPrevented || event.nativeEvent.isComposing)
                return;
              const up = matchesShortcut(event, "reorder-up", bindings, mac);
              if (!up && !matchesShortcut(event, "reorder-down", bindings, mac))
                return;
              event.preventDefault();
              event.stopPropagation();
              const target = task.pending[index + (up ? -1 : 1)];
              if (target) {
                restoreFocus.current = {
                  id: input.id,
                  overId: target.id,
                  edge: up ? "before" : "after",
                };
                void update(
                  {
                    action: "reorder",
                    inputId: input.id,
                    overId: target.id,
                    edge: up ? "before" : "after",
                  },
                  `Message moved ${up ? "up" : "down"}.`,
                );
              }
            }}
          >
            <GripVertical size={14} />
          </button>
          <div className="task-queue-content">
            <details className="task-queue-preview">
              <summary>
                <span>
                  {requestLabel(input.text, input.requestOrigin) ?? input.text}
                </span>
                <ChevronRight size={12} aria-hidden="true" />
              </summary>
              {requestLabel(input.text, input.requestOrigin) && (
                <p>{input.text}</p>
              )}
            </details>
            {input.scheduledAt && (
              <time className="task-queue-time" dateTime={input.scheduledAt}>
                {scheduledTime(input.scheduledAt)}
              </time>
            )}
          </div>
          <div className="task-queue-actions">
            {(index > 0 || input.scheduledAt) && (
              <button
                type="button"
                aria-label={`Move queued message ${index + 1} to front`}
                title="Deliver next"
                disabled={busy || task.archived || readOnly || Boolean(editing)}
                onClick={() =>
                  void update(
                    { action: "promote", inputId: input.id },
                    "Message moved to the front.",
                  )
                }
              >
                <ArrowUpToLine size={14} />
              </button>
            )}
            <SchedulePicker
              value={input.scheduledAt}
              compact
              label={`Schedule queued message ${index + 1}`}
              disabled={busy || task.archived || readOnly || Boolean(editing)}
              onChange={(scheduledAt) =>
                update(
                  {
                    action: "schedule",
                    inputId: input.id,
                    expectedText: input.text,
                    scheduledAt,
                  },
                  scheduledAt
                    ? "Message scheduled."
                    : "Scheduled time cleared.",
                  true,
                )
              }
            />
            <button
              type="button"
              aria-label={`Edit queued message ${index + 1}`}
              ref={(element) => {
                if (element) editButtons.current.set(input.id, element);
                else editButtons.current.delete(input.id);
              }}
              title="Edit"
              disabled={busy || task.archived || readOnly || Boolean(editing)}
              onClick={() => {
                setEditing(input);
                editFocus.current = input.id;
                setDraft(input.text);
                setError("");
              }}
            >
              <Pencil size={14} />
            </button>
            <button
              type="button"
              aria-label={`Remove queued message ${index + 1}`}
              title="Remove"
              disabled={busy || task.archived || Boolean(editing)}
              onClick={() =>
                void update(
                  {
                    action: "remove",
                    inputId: input.id,
                    expectedText: input.text,
                  },
                  "Queued message removed.",
                )
              }
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ))}
      {editing && (
        <div
          className="task-queue-editor"
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.nativeEvent.isComposing) return;
            if (matchesShortcut(event, "cancel-edit", bindings, mac)) {
              event.preventDefault();
              event.stopPropagation();
              cancelEdit();
            } else submitFromField(event, saveEdit);
          }}
        >
          <TextArea
            hasAutoFocus
            label="Queued message"
            isDisabled={busy}
            value={draft}
            onChange={setDraft}
            rows={4}
          />
          {!stillQueued && (
            <p className="task-queue-error">
              This message has left the queue. Your edit is still here.
            </p>
          )}
          <div className="task-queue-editor-actions">
            <Button
              size="sm"
              variant="ghost"
              label="Cancel"
              isDisabled={busy}
              onClick={cancelEdit}
            />
            {stillQueued ? (
              <Button
                size="sm"
                label="Save"
                isLoading={busy}
                isDisabled={
                  busy ||
                  !draft.trim() ||
                  draft.trim().length > 30000 ||
                  task.archived
                }
                onClick={saveEdit}
              />
            ) : (
              <Button
                size="sm"
                label="Use as follow-up"
                isDisabled={busy || !draft.trim() || task.archived}
                onClick={() => {
                  editFocus.current = null;
                  onUseAsFollowUp(draft);
                  setEditing(null);
                  setError("");
                }}
              />
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="task-queue-error" role="alert">
          {error}
        </p>
      )}
      <span className="task-queue-announcement" role="status">
        {notice}
      </span>
    </section>
  );
}
