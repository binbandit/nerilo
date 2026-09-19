"use client";
import { useState } from "react";
import { Shield } from "lucide-react";
import type { Sandbox, Task } from "@nerilo/protocol";
import { Button, CheckboxInput, Selector, Text } from "@/components/ui";
import { Modal } from "@/components/editors";
import { mutate } from "@/lib/api";
import "./sandbox-controls.css";

function Fields({
  value,
  onChange,
}: {
  value: Sandbox;
  onChange: (value: Sandbox) => void;
}) {
  return (
    <div className="sandbox-fields">
      <div className="sandbox-access-fields">
        <Selector
          label="Workspace access"
          value={value.workspace}
          onChange={(workspace) =>
            onChange({
              ...value,
              workspace: workspace === "read-only" ? "read-only" : "write",
            })
          }
          options={[
            { value: "write", label: "Read and write" },
            { value: "read-only", label: "Read only" },
          ]}
        />
        <Selector
          label="Network access"
          value={value.network}
          onChange={(network) =>
            onChange({
              ...value,
              network:
                network === "provider-only" ? "provider-only" : "internet",
            })
          }
          options={[
            { value: "internet", label: "Internet" },
            { value: "provider-only", label: "AI provider only" },
          ]}
        />
      </div>
      {value.network === "provider-only" && (
        <Text type="supporting">
          Only the agent provider can be reached. Preparation and checks cannot
          download packages or access other sites.
        </Text>
      )}
      {value.workspace === "read-only" && (
        <Text type="supporting">
          Preparation runs first. The agent and checks then receive a read-only
          workspace.
        </Text>
      )}
      <section className="sandbox-resources">
        <h3>Resources</h3>
        <div className="sandbox-resource-fields">
          <Selector
            label="CPU cores"
            value={String(value.cpus)}
            onChange={(cpus) => onChange({ ...value, cpus: Number(cpus) })}
            options={[...new Set([0.5, 1, 2, 4, 8, 16, value.cpus])]
              .sort((a, b) => a - b)
              .map(String)}
          />
          <Selector
            label="Memory"
            value={String(value.memoryMB)}
            onChange={(memoryMB) =>
              onChange({ ...value, memoryMB: Number(memoryMB) })
            }
            options={[
              ...new Set([
                512,
                1024,
                2048,
                4096,
                8192,
                16384,
                32768,
                value.memoryMB,
              ]),
            ]
              .sort((a, b) => a - b)
              .map((value) => ({
                value: String(value),
                label: value % 1024 ? `${value} MB` : `${value / 1024} GB`,
              }))}
          />
          <Selector
            label="Process limit"
            value={String(value.pids)}
            onChange={(pids) => onChange({ ...value, pids: Number(pids) })}
            options={[...new Set([64, 128, 256, 512, 1024, value.pids])]
              .sort((a, b) => a - b)
              .map(String)}
          />
        </div>
      </section>
    </div>
  );
}

export function SandboxControls({
  task,
  defaults,
  onSaved,
  triggerLabel,
}: {
  task?: Task;
  triggerLabel?: string;
  defaults: Sandbox;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        label={triggerLabel ?? (task ? "Sandbox" : "Sandbox defaults")}
        icon={triggerLabel ? undefined : <Shield size={14} />}
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      />
      {open && (
        <SandboxDialog
          task={task}
          defaults={defaults}
          onSaved={onSaved}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function SandboxDialog({
  task,
  defaults,
  onSaved,
  onClose,
}: {
  task?: Task;
  defaults: Sandbox;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(task?.sandbox ?? defaults);
  const [inherit, setInherit] = useState(task?.sandbox == null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await mutate(
        task ? `tasks/${task.id}/sandbox` : "sandbox-defaults",
        task ? { sandbox: inherit ? null : value } : value,
      );
      onSaved();
      onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Sandbox settings could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={task ? "Task sandbox" : "Sandbox defaults"}
      width={540}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button
          label="Save changes"
          variant="primary"
          isLoading={busy}
          onClick={() => void save()}
        />
      }
    >
      {task && (
        <CheckboxInput
          label="Use workspace defaults"
          value={inherit}
          onChange={setInherit}
        />
      )}
      {task && inherit && (
        <Text type="supporting">
          {defaults.workspace === "write" ? "Read and write" : "Read only"}
          {" · "}
          {defaults.network === "internet" ? "Internet" : "AI provider only"}
          <br />
          {defaults.cpus} CPU cores · {defaults.memoryMB / 1024} GB memory ·{" "}
          {defaults.pids} processes
        </Text>
      )}
      {(!task || !inherit) && <Fields value={value} onChange={setValue} />}
      <Text type="supporting">Changes apply to the next turn.</Text>
      {error && <p role="alert">{error}</p>}
    </Modal>
  );
}
