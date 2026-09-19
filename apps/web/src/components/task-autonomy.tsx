"use client";
import { useEffect, useState } from "react";
import { Orbit } from "lucide-react";
import { RadioList, RadioListItem } from "@astryxdesign/core";
import { autonomySchema, type Autonomy, type Task } from "@nerilo/protocol";
import { Button, TextInput } from "@/components/ui";
import { Modal } from "@/components/editors";
import { read, mutate } from "@/lib/api";
import "./task-autonomy.css";
export function TaskAutonomy({
  task,
  base,
  refresh,
}: {
  task: Task;
  base: string;
  refresh: () => void;
}) {
  const [state, setState] = useState<Autonomy | null>(null);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Autonomy["mode"]>("off");
  const [branch, setBranch] = useState(base);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const value = await read(`tasks/${task.id}/autonomy`);
        if (active) setState(value ? autonomySchema.parse(value) : null);
      } catch {}
    };
    void load();
    const timer = setInterval(() => void load(), 7000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [task.id]);
  const save = async () => {
    if (busy || (mode !== "off" && !branch.trim())) return;
    setBusy(true);
    setError("");
    try {
      const next = await mutate(`tasks/${task.id}/autonomy`, {
        mode,
        base: branch,
      });
      setState(next ? autonomySchema.parse(next) : null);
      refresh();
      setOpen(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update Autopilot.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        icon={<Orbit size={14} />}
        label={
          state?.mode && state.mode !== "off" ? "Autopilot on" : "Autopilot"
        }
        onClick={() => {
          setMode(state?.mode ?? "off");
          setBranch(state?.base ?? base);
          setOpen(true);
          setError("");
        }}
      />
      {open && (
        <Modal
          title="Autopilot"
          onSubmit={() => void save()}
          width={420}
          onClose={() => {
            if (!busy) setOpen(false);
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
              label="Open a pull request"
              description="Commit, push, and resolve PR feedback and CI."
            />
            <RadioListItem
              value="merge"
              label="Through to merge"
              description="Also squash-merge when checks and repo rules pass."
            />
          </RadioList>
          {mode !== "off" && (
            <>
              <TextInput
                label="Base branch"
                value={branch}
                onChange={setBranch}
                isDisabled={busy}
              />
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
      )}
    </>
  );
}
