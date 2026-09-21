"use client";

import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import type { Project, TaskDetail } from "@nerilo/protocol";
import { ArrowDownToLine, FileCode2, FolderGit2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Text } from "@/components/ui/ui";
import { DiffReview } from "@/features/review/diff-review";
import { apiUrl } from "@/lib/api";

export function TaskChanges({
  detail,
  project,
  running,
  reviewTurnId,
  onSelectTurn,
  onConfirm,
  onSend,
}: {
  detail: TaskDetail;
  project: Project | undefined;
  running: boolean;
  reviewTurnId: string | null;
  onSelectTurn: (turnId: string) => void;
  onConfirm: (action: "apply" | "checkout", turnId: string) => void;
  onSend: (text: string, commentCount: number) => Promise<boolean>;
}) {
  const { task, turns } = detail;
  const latest = turns.at(-1);
  const priorResult = turns.some((turn) => turn.result);
  const reviewTurn =
    turns.find((turn) => turn.id === reviewTurnId) ??
    turns.findLast((turn) => turn.result);
  const reviewResult = reviewTurn?.result;
  const reviewHeadingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      reviewHeadingRef.current
        ?.closest(".task-page")
        ?.scrollIntoView({ block: "start" });
      reviewHeadingRef.current
        ?.querySelector("button")
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [reviewTurn?.id]);

  return (
    <div className="changes-view">
      {reviewTurn && reviewResult ? (
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
                        onClick: () => onSelectTurn(turn.id),
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
                    onClick={() => onConfirm("checkout", reviewTurn.id)}
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
                      onClick={() => onConfirm("apply", reviewTurn.id)}
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
          <p className="review-comparison">
            This turn’s workspace result compared with its starting base,
            including uncommitted files and any updates brought in from the base
            branch. The Changes panel compares the local checkout with its
            commit or starting base, so its file count can differ.
          </p>
          {reviewResult.truncated && (
            <div className="attention-note">
              This diff exceeds the preview limit. Patch export and application
              are unavailable.
            </div>
          )}
          {reviewResult.diff ? (
            <DiffReview
              key={`${task.id}:${reviewTurn.id}:${reviewResult.headCommit}`}
              taskId={task.id}
              turnId={reviewTurn.id}
              revision={reviewResult.headCommit}
              baseRevision={reviewResult.baseCommit}
              text={reviewResult.diff}
              running={running}
              readOnly={
                task.archived || project?.archived || reviewResult.truncated
              }
              onSend={onSend}
            />
          ) : (
            <div className="empty-list">
              <FileCode2 size={24} />
              <Text color="secondary">No file changes in this result.</Text>
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
              Previous work is retained. This view will update with the new
              result.
            </Text>
          )}
        </div>
      )}
    </div>
  );
}
