"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import {
  ChevronRight,
  FileDiff,
  MessageSquarePlus,
  Pencil,
  Trash2,
} from "lucide-react";
import { matchesShortcut } from "@nerilo/protocol";
import { Button, TextArea } from "@/components/ui";
import { HighlightedLines } from "@/components/code-text";
import { useDraft } from "@/lib/use-draft";
import { useSubmitFromField } from "@/lib/form-keyboard";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/lib/shortcut-preferences";
import {
  formatReviewPrompt,
  parseReviewComments,
  parseReviewDiff,
  type ReviewComment,
  type ReviewFile,
  type ReviewLine,
} from "@/lib/diff-review";
import "./diff-review.css";

type Anchor = Pick<ReviewComment, "fileId" | "path" | "side" | "line" | "code">;
function lineAnchor(file: ReviewFile, line: ReviewLine): Anchor | null {
  if (line.kind === "meta") return null;
  const side = line.kind === "remove" ? "old" : "new";
  const number = side === "old" ? line.oldLine : line.newLine;
  const path = side === "old" ? file.oldPath : file.newPath;
  return number !== null && path
    ? {
        fileId: file.id,
        path,
        side,
        line: number,
        code: line.text.slice(1, 2001),
      }
    : null;
}
function sameLine(comment: ReviewComment, anchor: Anchor) {
  return (
    comment.fileId === anchor.fileId &&
    comment.side === anchor.side &&
    comment.line === anchor.line
  );
}

export function DiffReview({
  taskId,
  turnId,
  revision,
  baseRevision,
  text,
  readOnly = false,
  running,
  onSend,
}: {
  taskId: string;
  turnId: string;
  revision: string;
  baseRevision: string;
  text: string;
  readOnly?: boolean;
  running: boolean;
  onSend: (prompt: string, commentCount: number) => Promise<boolean>;
}) {
  const files = useMemo(() => parseReviewDiff(text), [text]);
  const [saved, save] = useDraft(`review:${taskId}:${turnId}:${revision}`);
  const comments = useMemo(() => parseReviewComments(saved), [saved]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sending = useRef(false);
  const locked = busy || readOnly;
  const update = (next: ReviewComment[]) =>
    save(next.length ? JSON.stringify(next) : "");
  const commentOn = (anchor: Anchor) => {
    if (locked) return;
    const existing = comments.find((comment) => sameLine(comment, anchor));
    if (existing) setEditing(existing.id);
    else if (comments.length < 50) {
      const next = { ...anchor, id: crypto.randomUUID(), body: "" };
      update([...comments, next]);
      setEditing(next.id);
    }
  };
  const send = async () => {
    if (
      sending.current ||
      locked ||
      !comments.length ||
      comments.some((comment) => !comment.body.trim())
    )
      return;
    sending.current = true;
    setBusy(true);
    setError("");
    try {
      if (
        await onSend(
          formatReviewPrompt(comments, revision, baseRevision),
          comments.length,
        )
      ) {
        update([]);
        setEditing(null);
      } else setError("Review wasn't sent. Your comments are still saved.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Review wasn't sent. Your comments are still saved.",
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="diff-review">
      <div className="review-context">
        <span>
          {readOnly
            ? "Read-only review"
            : "Comment on a line to give the agent feedback."}
        </span>
        <code title={revision}>{revision.slice(0, 8)}</code>
      </div>
      {files.length ? (
        files.map((file, index) => (
          <ReviewFileView
            key={file.id}
            file={file}
            initiallyOpen={
              index === 0 ||
              comments.some((comment) => comment.fileId === file.id)
            }
            comments={comments.filter((comment) => comment.fileId === file.id)}
            editing={editing}
            locked={locked}
            limitReached={comments.length >= 50}
            onComment={commentOn}
            onEdit={setEditing}
            onChange={(id, body) =>
              update(
                comments.map((comment) =>
                  comment.id === id ? { ...comment, body } : comment,
                ),
              )
            }
            onRemove={(id) => {
              update(comments.filter((comment) => comment.id !== id));
              setEditing(null);
            }}
          />
        ))
      ) : (
        <p className="review-empty">
          This result has no reviewable file changes.
        </p>
      )}
      {comments.length > 0 && (
        <div className="review-send-bar">
          <span>
            {comments.length} {comments.length === 1 ? "comment" : "comments"}
            <small>Saved in this browser</small>
          </span>
          <Button
            label={running ? "Queue review" : "Send review"}
            variant="primary"
            size="sm"
            isLoading={busy}
            isDisabled={
              locked || comments.some((comment) => !comment.body.trim())
            }
            onClick={() => void send()}
          />
        </div>
      )}
      {error && (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function ReviewFileView({
  file,
  initiallyOpen,
  comments,
  editing,
  locked,
  limitReached,
  onComment,
  onEdit,
  onChange,
  onRemove,
}: {
  file: ReviewFile;
  initiallyOpen: boolean;
  comments: ReviewComment[];
  editing: string | null;
  locked: boolean;
  limitReached: boolean;
  onComment: (anchor: Anchor) => void;
  onEdit: (id: string | null) => void;
  onChange: (id: string, body: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const selectable = file.lines.filter((line) => lineAnchor(file, line));
  const [focused, setFocused] = useState(selectable[0]?.id);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  const submitFromField = useSubmitFromField();
  const additions = file.lines.filter((line) => line.kind === "add").length;
  const deletions = file.lines.filter((line) => line.kind === "remove").length;
  const finish = (line: ReviewLine) => {
    onEdit(null);
    requestAnimationFrame(() => buttons.current.get(line.id)?.focus());
  };
  return (
    <details
      className="review-file"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <ChevronRight size={13} className="review-file-chevron" />
        <FileDiff size={15} />
        <span className="review-file-name" title={file.path}>
          {file.path}
        </span>
        {comments.length > 0 && (
          <span className="review-file-count">{comments.length}</span>
        )}
        <span className="review-file-stats">
          <span className="addition">+{additions}</span>
          <span className="deletion">−{deletions}</span>
        </span>
      </summary>
      {open && (
        <>
          {file.oldPath && file.newPath && file.oldPath !== file.newPath && (
            <p className="review-rename">Renamed from {file.oldPath}</p>
          )}
          {file.binary || !file.lines.length ? (
            <p className="review-empty">
              {file.binary ? "Binary file changed" : "No text changes"}
            </p>
          ) : (
            <div
              className="review-code-scroll"
              tabIndex={0}
              aria-label={`Changes in ${file.path}`}
            >
              <HighlightedLines
                lines={file.lines.map((line) =>
                  line.kind === "meta" ? "" : line.text.slice(1),
                )}
                path={file.path}
                renderLine={(content, index) => {
                  const line = file.lines[index];
                  const anchor = lineAnchor(file, line);
                  const comment =
                    anchor &&
                    comments.find((comment) => sameLine(comment, anchor));
                  return (
                    <Fragment key={line.id}>
                      <div className={`review-code-line ${line.kind}`}>
                        {anchor && !locked ? (
                          <button
                            type="button"
                            className={`review-line-action ${comment ? "has-comment" : ""}`}
                            title={comment ? "Edit comment" : "Add comment"}
                            aria-label={`Comment on ${anchor.path}, ${anchor.side === "old" ? "deleted" : "new"} line ${anchor.line}`}
                            disabled={limitReached && !comment}
                            tabIndex={focused === line.id ? 0 : -1}
                            ref={(element) => {
                              if (element)
                                buttons.current.set(line.id, element);
                              else buttons.current.delete(line.id);
                            }}
                            onFocus={() => setFocused(line.id)}
                            onClick={() => onComment(anchor)}
                            onKeyDown={(event) => {
                              const index = selectable.findIndex(
                                (item) => item.id === line.id,
                              );
                              const next = matchesShortcut(
                                event,
                                "row-first",
                                bindings,
                                mac,
                              )
                                ? 0
                                : matchesShortcut(
                                      event,
                                      "row-last",
                                      bindings,
                                      mac,
                                    )
                                  ? selectable.length - 1
                                  : matchesShortcut(
                                        event,
                                        "row-next",
                                        bindings,
                                        mac,
                                      )
                                    ? Math.min(index + 1, selectable.length - 1)
                                    : matchesShortcut(
                                          event,
                                          "row-previous",
                                          bindings,
                                          mac,
                                        )
                                      ? Math.max(index - 1, 0)
                                      : null;
                              if (next === null) return;
                              event.preventDefault();
                              event.stopPropagation();
                              setFocused(selectable[next].id);
                              buttons.current.get(selectable[next].id)?.focus();
                            }}
                          >
                            <MessageSquarePlus size={13} />
                          </button>
                        ) : (
                          <span />
                        )}
                        <span className="review-line-number">
                          {line.oldLine}
                        </span>
                        <span className="review-line-number">
                          {line.newLine}
                        </span>
                        <code>
                          <span className="review-line-sign" aria-hidden="true">
                            {line.kind === "meta" ? "" : line.text[0]}
                          </span>
                          {line.kind === "meta" ? line.text : content}
                        </code>
                      </div>
                      {comment && (
                        <div className="review-line-comment">
                          {editing === comment.id && !locked ? (
                            <div
                              className="review-comment-editor"
                              onKeyDown={(event) => {
                                if (
                                  matchesShortcut(
                                    event,
                                    "cancel-edit",
                                    bindings,
                                    mac,
                                  )
                                ) {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  finish(line);
                                } else
                                  submitFromField(event, () => finish(line));
                              }}
                            >
                              <TextArea
                                label={`Comment on ${anchor.path}:${anchor.line}${anchor.side === "old" ? " (deleted)" : ""}`}
                                value={comment.body}
                                onChange={(body) =>
                                  onChange(comment.id, body.slice(0, 4000))
                                }
                                rows={3}
                                hasAutoFocus
                              />
                              <div className="review-comment-actions">
                                <Button
                                  label="Remove"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    onRemove(comment.id);
                                    finish(line);
                                  }}
                                />
                                <Button
                                  label="Done"
                                  size="sm"
                                  onClick={() => finish(line)}
                                />
                              </div>
                            </div>
                          ) : (
                            <div className="review-comment-summary">
                              <p>{comment.body || "Write a comment…"}</p>
                              {!locked && (
                                <div className="review-comment-tools">
                                  <button
                                    type="button"
                                    aria-label={`Edit comment on ${comment.path}:${comment.line}${comment.side === "old" ? " (deleted)" : ""}`}
                                    onClick={() => onEdit(comment.id)}
                                  >
                                    <Pencil size={13} />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Remove comment on ${comment.path}:${comment.line}${comment.side === "old" ? " (deleted)" : ""}`}
                                    onClick={() => {
                                      onRemove(comment.id);
                                      finish(line);
                                    }}
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </Fragment>
                  );
                }}
              />
            </div>
          )}
        </>
      )}
    </details>
  );
}
