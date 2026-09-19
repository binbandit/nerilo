"use client";
import { useRef, useState } from "react";
import { activeStatuses, type Project, type Snapshot } from "@nerilo/protocol";
import { Modal } from "@/components/editors";
import { Button } from "@/components/ui";
import { mutate } from "@/lib/api";
import "./project-lifecycle.css";

export type ProjectAction = {
  project: Project;
  action: "archive" | "restore" | "delete";
};
export function ProjectActionDialog({
  value,
  data,
  onClose,
  onSaved,
  refresh,
}: {
  value: ProjectAction;
  data: Snapshot;
  onClose: () => void;
  onSaved: () => void;
  refresh: () => void;
}) {
  const { project, action } = value;
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState("");
  const tasks = data.tasks.filter((task) => task.projectId === project.id);
  const running = tasks.filter(
    (task) => task.activeTurnId || activeStatuses.includes(task.status),
  );
  const label =
    action === "delete"
      ? "Delete project"
      : action === "archive"
        ? "Archive project"
        : "Restore project";
  async function save() {
    if (pending.current || (action !== "restore" && running.length)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await mutate(
        `projects/${project.id}/${action === "delete" ? "delete" : "archive"}`,
        action === "delete" ? {} : { archived: action === "archive" },
      );
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update this project.",
      );
      refresh();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`${label}: ${project.name}`}
      width={440}
      onClose={() => {
        if (!pending.current) onClose();
      }}
      footer={
        <>
          <Button
            label="Cancel"
            variant="ghost"
            isDisabled={busy}
            onClick={onClose}
          />
          <Button
            label={label}
            isDisabled={busy || (action !== "restore" && running.length > 0)}
            isLoading={busy}
            onClick={() => void save()}
          />
        </>
      }
    >
      {action === "delete" ? (
        <p>
          This permanently deletes the project,{" "}
          {tasks.length === 1 ? "its task" : `its ${tasks.length} tasks`},
          notes, and agent sandboxes from Nerilo. Local folders and the GitHub
          repository are kept.
        </p>
      ) : action === "archive" ? (
        <p>
          Hides this project and pauses queued work and Autopilot. Its tasks and
          notes stay available in Projects → Archived.
        </p>
      ) : (
        <p>
          The project will return to your sidebar. Paused tasks stay paused.
        </p>
      )}
      {action !== "restore" && running.length > 0 && (
        <p role="status">
          Pause{" "}
          {running.length === 1
            ? `“${running[0].title}”`
            : `the ${running.length} running tasks`}{" "}
          before {action === "delete" ? "deleting" : "archiving"} this project.
        </p>
      )}
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
    </Modal>
  );
}
