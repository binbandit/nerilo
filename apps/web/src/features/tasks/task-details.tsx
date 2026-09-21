"use client";
import { describeExecution, providerNames } from "@nerilo/protocol";
import { useQuery } from "@tanstack/react-query";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";

import type { TaskDetail } from "@nerilo/protocol";
import { ChevronRight, FileCode2, FolderOpen, X } from "lucide-react";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { Button, Text } from "@/components/ui/ui";

export function TaskDetails({
  detail,
  openFile,
  onBrowseFiles,
  onClose,
}: {
  detail: TaskDetail;
  openFile: (path: string) => void;
  onBrowseFiles: () => void;
  onClose: () => void;
}) {
  const { task, turns } = detail;
  const { machineId, ready } = useSession();
  const { data: catalog } = useQuery({
    ...queries.models(machineId),
    enabled: ready,
  });
  const selection = describeExecution(task, catalog);
  const result = turns.at(-1)?.result;
  return (
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
            onClose();
            document
              .querySelector<HTMLButtonElement>('[aria-label="Task details"]')
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
              onClick={() => openFile(change.path)}
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
        onClick={onBrowseFiles}
      />
      <details className="session-details">
        <summary>
          Session <ChevronRight size={12} aria-hidden="true" />
        </summary>
        <div>
          <Text type="supporting">
            {providerNames[task.provider]} · Requested model: {selection.model}
          </Text>
          <Text type="supporting">Requested effort: {selection.effort}</Text>
          <Text type="supporting">
            {turns.length} {turns.length === 1 ? "turn" : "turns"}
          </Text>
          {task.source && (
            <Text type="supporting">
              PR #{task.source.number} · {task.source.headCommit.slice(0, 8)}
            </Text>
          )}
          {task.sessionId && (
            <div className="session-identity">
              <span>Session ID</span>
              <CopyTextButton text={task.sessionId} label="Copy session ID" />
              <code>{task.sessionId}</code>
            </div>
          )}
        </div>
      </details>
    </aside>
  );
}
