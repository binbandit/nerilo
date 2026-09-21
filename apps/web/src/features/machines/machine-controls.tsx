"use client";

import { useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Monitor,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Upload,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@astryxdesign/core/DropdownMenu";
import { machineRegistrationSchema, type Machine } from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { Modal } from "@/components/editors/editors";
import { Button, TextInput } from "@/components/ui/ui";

import { useMachines } from "@/features/machines/machines";
import "@/features/machines/machine-controls.css";
import "@/components/ui/compact-picker.css";

const connectionFileSchema = machineRegistrationSchema.omit({ name: true });
type Editor =
  | { action: "add" }
  | { action: "rename" | "reconnect" | "remove"; machine: Machine };

export function MachinePicker({
  placement = "below",
}: {
  placement?: "above" | "below";
}) {
  const { machines, current, currentId, switchMachine, loading } =
    useMachines();
  const [manage, setManage] = useState(false);
  const machineName =
    current?.name ||
    (currentId === "local" ? "This machine" : "Selected machine");
  return (
    <>
      <DropdownMenu
        alignment="start"
        placement={placement}
        menuWidth={244}
        button={{
          label: machineName,
          "aria-label": `Machine: ${machineName}`,
          tooltip: machineName,
          icon: <Monitor size={14} />,
          variant: "ghost",
          size: "sm",
          className: "machine-picker-trigger",
          "aria-busy": loading,
        }}
      >
        <DropdownMenuRadioGroup
          label="Run tasks on"
          value={currentId}
          onChange={switchMachine}
        >
          {machines.map((machine) => (
            <DropdownMenuRadioItem
              key={machine.id}
              value={machine.id}
              className="compact-picker-option"
              label={
                <span className="machine-menu-label">
                  <span>{machine.name}</span>
                  {machine.status === "offline" && <small>Offline</small>}
                </span>
              }
              icon={<Monitor size={14} />}
              endContent={
                <span className="compact-picker-check" aria-hidden="true">
                  {machine.id === currentId && <Check size={13} />}
                </span>
              }
            />
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuItem
          label="Manage machines"
          className="compact-picker-option"
          icon={<Plus size={14} />}
          onClick={() => setManage(true)}
        />
      </DropdownMenu>
      <MachinesDialog open={manage} onClose={() => setManage(false)} />
    </>
  );
}

export function MachinesDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <Modal title="Machines" width={520} onClose={onClose}>
      <MachinesSettings compact />
    </Modal>
  );
}

export function MachinesSettings({ compact = false }: { compact?: boolean }) {
  const { machines, currentId, error, loading, refresh, switchMachine } =
    useMachines();
  const [editor, setEditor] = useState<Editor | null>(null);
  const [checking, setChecking] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  function closeEditor() {
    const id = editor && "machine" in editor ? editor.machine.id : null;
    setEditor(null);
    requestAnimationFrame(() => {
      const trigger = id
        ? list.current?.querySelector<HTMLButtonElement>(
            `[data-machine-id="${id}"] button`,
          )
        : null;
      (trigger ?? addButton.current)?.focus();
    });
  }
  const check = async () => {
    setChecking(true);
    await refresh();
    setChecking(false);
  };
  return (
    <div className="machines-settings">
      <header
        className={
          compact ? "machines-heading" : "preferences-heading machines-heading"
        }
      >
        <div>
          {!compact && <h2>Machines</h2>}
          <p>Each machine keeps its own projects, agents, and credentials.</p>
        </div>
        <div className="machines-heading-actions">
          <Button
            label="Refresh machines"
            icon={
              <RefreshCw
                size={14}
                className={checking ? "machine-refreshing" : ""}
              />
            }
            isIconOnly
            variant="ghost"
            size="sm"
            isDisabled={checking}
            onClick={() => void check()}
          />
          <Button
            ref={addButton}
            label="Add machine"
            icon={<Plus size={14} />}
            size="sm"
            onClick={() => setEditor({ action: "add" })}
          />
        </div>
      </header>
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
      {loading && !machines.length && (
        <p className="machine-description" role="status">
          Loading machines…
        </p>
      )}
      <div className="machine-list" ref={list}>
        {machines.map((machine) => (
          <div
            className="machine-row"
            key={machine.id}
            data-machine-id={machine.id}
          >
            <Monitor size={18} className="machine-row-icon" />
            <div className="machine-row-detail">
              <div className="machine-row-name">
                <strong>{machine.name}</strong>
                {machine.id === currentId && <span>Selected</span>}
              </div>
              <p>
                <span
                  className={`machine-status-dot ${machine.status}`}
                  aria-hidden="true"
                />
                {machine.status === "online" ? "Connected" : "Offline"}
                {machine.platform
                  ? ` · ${{ darwin: "macOS", linux: "Linux", win32: "Windows" }[machine.platform] || machine.platform}`
                  : ""}
              </p>
              {machine.status === "offline" && machine.error && (
                <p className="machine-connection-error">{machine.error}</p>
              )}
            </div>
            {(machine.id !== "local" || machine.id !== currentId) && (
              <DropdownMenu
                alignment="end"
                menuWidth={170}
                button={{
                  label: `Actions for ${machine.name}`,
                  isIconOnly: true,
                  icon: <MoreHorizontal size={16} />,
                  variant: "ghost",
                  size: "sm",
                }}
                items={[
                  ...(machine.id !== currentId
                    ? [
                        {
                          label: "Use machine",
                          onClick: () => switchMachine(machine.id),
                        },
                      ]
                    : []),
                  ...(machine.id !== "local"
                    ? [
                        {
                          label: "Rename",
                          onClick: () =>
                            setEditor({ action: "rename", machine }),
                        },
                        {
                          label: "Connection…",
                          onClick: () =>
                            setEditor({ action: "reconnect", machine }),
                        },
                        {
                          label: "Remove",
                          onClick: () =>
                            setEditor({ action: "remove", machine }),
                        },
                      ]
                    : []),
                ]}
              />
            )}
          </div>
        ))}
      </div>
      {editor && (
        <MachineEditor
          key={editor.action + ("machine" in editor ? editor.machine.id : "")}
          editor={editor}
          onClose={closeEditor}
          onSaved={async () => {
            closeEditor();
            if (editor.action === "remove" && editor.machine.id === currentId)
              switchMachine("local");
          }}
        />
      )}
    </div>
  );
}

function MachineEditor({
  editor,
  onClose,
  onSaved,
}: {
  editor: Editor;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { mutateAsync: send } = useApiMutation();
  const [name, setName] = useState(
    "machine" in editor ? editor.machine.name : "",
  );
  const [url, setUrl] = useState("machine" in editor ? editor.machine.url : "");
  const [token, setToken] = useState("");
  const [machineId, setMachineId] = useState<string | undefined>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const connection = editor.action === "add" || editor.action === "reconnect";
  const title = {
    add: "Add machine",
    rename: "Rename machine",
    reconnect: "Machine connection",
    remove: "Remove machine",
  }[editor.action];
  const valid =
    editor.action === "remove" ||
    (editor.action === "rename"
      ? Boolean(name.trim())
      : Boolean(name.trim() && url.trim() && token.trim()));
  async function submit() {
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const body =
        editor.action === "add"
          ? {
              name: name.trim(),
              url: url.trim(),
              token: token.trim(),
              ...(machineId ? { machineId } : {}),
            }
          : editor.action === "rename"
            ? { action: "rename", name: name.trim() }
            : editor.action === "reconnect"
              ? {
                  action: "reconnect",
                  url: url.trim(),
                  token: token.trim(),
                  ...(machineId ? { machineId } : {}),
                }
              : { action: "remove" };
      await send({
        path:
          editor.action === "add"
            ? "machines"
            : `machines/${editor.machine.id}`,
        body,
      });
      setToken("");
      await onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not update this machine.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }
  async function importConnection(file: File) {
    setError("");
    try {
      if (file.size > 16_384)
        throw new Error("Choose a Nerilo connection file.");
      const value: unknown = JSON.parse(await file.text());
      const parsed = connectionFileSchema.safeParse(value);
      if (!parsed.success)
        throw new Error("This file needs a daemon URL and connection token.");
      setUrl(parsed.data.url);
      setToken(parsed.data.token);
      setMachineId(parsed.data.machineId);
    } catch (reason) {
      setError(
        reason instanceof SyntaxError
          ? "Choose a valid JSON connection file."
          : reason instanceof Error
            ? reason.message
            : "The connection file could not be read.",
      );
    }
  }
  return (
    <Modal
      title={title}
      width={460}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button
            label="Cancel"
            variant="ghost"
            isDisabled={busy}
            onClick={onClose}
          />
          <Button
            label={
              busy
                ? "Saving…"
                : editor.action === "add"
                  ? "Connect"
                  : editor.action === "remove"
                    ? "Remove"
                    : "Save"
            }
            variant="primary"
            isDisabled={busy || !valid}
            onClick={() => void submit()}
          />
        </>
      }
    >
      {editor.action === "remove" ? (
        <p>
          Remove <strong>{editor.machine.name}</strong> from Nerilo? Its tasks
          and files stay on that machine.
        </p>
      ) : (
        <>
          {editor.action !== "reconnect" && (
            <TextInput
              label="Name"
              value={name}
              onChange={setName}
              placeholder="e.g. Mac Studio"
              isDisabled={busy}
              hasAutoFocus
            />
          )}
          {connection && (
            <>
              <TextInput
                label="Daemon URL"
                value={url}
                onChange={setUrl}
                placeholder="https://nerilo.example.com"
                isDisabled={busy}
              />
              <TextInput
                label="Connection token"
                value={token}
                onChange={setToken}
                type="password"
                placeholder={
                  editor.action === "reconnect"
                    ? "Paste the current token"
                    : "Paste the token from your machine"
                }
                isDisabled={busy}
              />
              <div className="machine-import">
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void importConnection(file);
                  }}
                />
                <Button
                  label="Import connection file"
                  icon={<Upload size={14} />}
                  variant="ghost"
                  size="sm"
                  onClick={() => fileInput.current?.click()}
                  isDisabled={busy}
                />
              </div>
              <p className="machine-description">
                Use HTTPS, or a localhost address forwarded through SSH.
                Credentials stay on the machine running the agent.
              </p>
              <MachineSetup />
            </>
          )}
        </>
      )}
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}

function MachineSetup() {
  const commands = [
    {
      title: "On the other machine",
      description:
        "Install Bun and Docker, then run these from its Nerilo checkout. Keep the daemon running.",
      command: "bun install\nbun run image:build\nbun run daemon",
    },
    {
      title: "On this machine",
      description:
        "Replace user@machine with your SSH destination. Keep the tunnel open.",
      command: "ssh -N -L 127.0.0.1:5187:127.0.0.1:5186 user@machine",
    },
    {
      title: "Export from the other machine",
      description: "Transfer this private file here and import it above.",
      command:
        'bun scripts/machine-connection.ts --url http://127.0.0.1:5187 --output "$HOME/nerilo-machine.json"',
    },
  ];
  return (
    <details className="machine-setup">
      <summary>
        <ChevronDown size={13} />
        Set up a machine
      </summary>
      <ol>
        {commands.map((step) => (
          <li key={step.title}>
            <strong>{step.title}</strong>
            <p>{step.description}</p>
            <div className="machine-setup-command">
              <pre>
                <code>{step.command}</code>
              </pre>
              <CopyTextButton
                text={step.command}
                label={`Copy command: ${step.title}`}
              />
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}
