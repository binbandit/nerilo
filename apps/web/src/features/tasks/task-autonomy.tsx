"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useApiMutation } from "@/lib/use-api-mutation";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { AlertCircle, Orbit } from "lucide-react";
import { RadioList, RadioListItem } from "@astryxdesign/core/RadioList";
import { type Autonomy, type Task } from "@nerilo/protocol";
import { Button, Selector, TextInput } from "@/components/ui/ui";
import { Modal } from "@/components/editors/editors";
import { autonomyStatusLabel } from "@/features/tasks/autonomy-status";
import "@/features/tasks/task-autonomy.css";
export function TaskAutonomy({ task, base }: { task: Task; base: string }) {
  const { machineId, ready } = useSession();
  const status = useQuery({
    ...queries.autonomy(machineId, task.id),
    enabled: ready,
  });
  const [open, setOpen] = useState(false);
  const state = status.data;
  const enabled = Boolean(state?.mode && state.mode !== "off");
  const blocked = enabled && state?.status === "blocked";
  const close = () => setOpen(false);
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={blocked ? "autopilot-trigger-blocked" : undefined}
        icon={blocked ? <AlertCircle size={14} /> : <Orbit size={14} />}
        label={autonomyStatusLabel(state)}
        tooltip={enabled ? state?.detail || undefined : undefined}
        aria-description={blocked ? state?.detail : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      {open &&
        (state === undefined ? (
          <Modal title="Autopilot" width={420} onClose={close}>
            {status.error ? (
              <div role="alert">
                <p>{status.error.message}</p>
                <Button
                  label="Try again"
                  onClick={() => void status.refetch()}
                />
              </div>
            ) : (
              <p role="status">Loading Autopilot…</p>
            )}
          </Modal>
        ) : (
          <AutonomyDialog
            taskId={task.id}
            task={task}
            base={base}
            state={state}
            readError={status.error}
            onClose={close}
          />
        ))}
    </>
  );
}

function AutonomyDialog({
  taskId,
  task,
  base,
  state,
  readError,
  onClose,
}: {
  taskId: string;
  task: Task;
  base: string;
  state: Autonomy | null;
  readError: Error | null;
  onClose: () => void;
}) {
  const {
    mutateAsync: send,
    isPending: busy,
    error: failure,
  } = useApiMutation(`task:${taskId}`);
  const submitting = useRef(false);
  const [mode, setMode] = useState<Autonomy["mode"]>(state?.mode ?? "off");
  const [branch, setBranch] = useState(state?.base ?? base);
  const existingPRs = task.pullRequests.filter(
    (pr) => pr.state === "open" || pr.state === "draft",
  );
  const [adoptURL, setAdoptURL] = useState(
    state?.prUrl ??
      (existingPRs.find((pr) => pr.url === task.source?.url) ?? existingPRs[0])
        ?.url ??
      "",
  );
  const selectedPR = existingPRs.find((pr) => pr.url === adoptURL);
  const error = (failure ?? readError)?.message ?? "";
  const save = async () => {
    if (submitting.current || (mode !== "off" && !branch.trim())) return;
    submitting.current = true;
    try {
      await send({
        path: `tasks/${taskId}/autonomy`,
        body: {
          mode,
          base: selectedPR?.base ?? branch,
          ...(mode !== "off" && !state?.prUrl && selectedPR
            ? { adoptPullRequest: selectedPR.url }
            : {}),
        },
      });

      onClose();
    } catch {
      // The mutation exposes the server error without losing the draft.
    } finally {
      submitting.current = false;
    }
  };

  return (
    <Modal
      title="Autopilot"
      onSubmit={() => void save()}
      width={420}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          label="Save"
          variant="primary"
          size="sm"
          isLoading={busy}
          isDisabled={busy || (mode !== "off" && !branch.trim())}
          onClick={() => void save()}
        />
      }
    >
      <RadioList
        className="autopilot-choices"
        label="Finish line"
        isLabelHidden
        size="sm"
        value={mode}
        isDisabled={busy}
        onChange={(value) => {
          if (value === "off" || value === "pr" || value === "merge")
            setMode(value);
        }}
      >
        <RadioListItem
          value="off"
          label="Off"
          description="Handle commits and pull requests yourself."
        />
        <RadioListItem
          value="pr"
          label={
            existingPRs.length
              ? "Continue the pull request"
              : "Open PR and address feedback"
          }
          description="Publish changes and address review feedback and CI. Leave merging to you."
        />
        <RadioListItem
          value="merge"
          label="Through to merge"
          description="Also squash-merge when checks and repo rules pass."
        />
      </RadioList>
      {mode !== "off" && (
        <>
          {existingPRs.length > 0 && !state?.prUrl && (
            <Selector
              label="Continue existing pull request"
              value={adoptURL}
              onChange={setAdoptURL}
              isDisabled={busy}
              options={existingPRs.map((pr) => ({
                value: pr.url,
                label: `#${pr.number} · ${pr.title}`,
              }))}
            />
          )}
          {selectedPR && (
            <p className="autopilot-explanation">
              Continue{" "}
              <a href={selectedPR.url} target="_blank" rel="noreferrer">
                PR #{selectedPR.number}
              </a>{" "}
              on <code>{selectedPR.head}</code>, keeping its existing reviews.
              Nerilo checks that no teammate has pushed new work before
              publishing.
            </p>
          )}
          <TextInput
            label="Base branch"
            value={selectedPR?.base ?? branch}
            onChange={setBranch}
            isDisabled={busy || Boolean(selectedPR) || Boolean(state?.prUrl)}
          />
          <p className="autopilot-explanation">
            {mode === "merge"
              ? "Before enabling, Nerilo checks access to the repository's merge rules. It merges only after verifying the latest checks, reviews, and branch requirements."
              : "Feedback and CI repairs can continue when GitHub does not expose branch protection. This finish line never merges the PR."}
          </p>
        </>
      )}
      {state?.detail && (
        <p className="autopilot-status" role="status">
          {state.detail}
        </p>
      )}
      {state?.prUrl && (
        <a
          className="autopilot-pr-link"
          href={state.prUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open pull request
        </a>
      )}
      {error && (
        <p className="error-note" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
