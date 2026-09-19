"use client";
import { useId, useState, type ReactNode } from "react";
import { Dialog } from "@astryxdesign/core/Dialog";
import {
  SegmentedControl,
  SegmentedControlItem,
} from "@astryxdesign/core/SegmentedControl";
import { Folder, Github, X } from "lucide-react";
import type {
  Snapshot,
  Project,
  Preset,
  Note,
  Provider,
} from "@nerilo/protocol";
import { Button, TextInput, TextArea, Selector } from "@/components/ui";
import { mutate } from "@/lib/api";
import { projectName } from "@/lib/project-name";
import { useSubmitFromField } from "@/lib/form-keyboard";
import { focusableControls } from "@/lib/focus";
import "./dialogs.css";

export function Modal({
  title,
  width = 520,
  children,
  onClose,
  footer,
  onSubmit,
}: {
  title: string;
  width?: number;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  onSubmit?: () => void;
}) {
  const submitFromField = useSubmitFromField();
  const titleId = useId();
  return (
    <Dialog
      className="nerilo-dialog"
      aria-labelledby={titleId}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      purpose="form"
      width={width}
      maxHeight="calc(100dvh - 40px)"
      padding={0}
    >
      <div
        className="nerilo-dialog-frame"
        onKeyDown={(event) => {
          if (onSubmit) submitFromField(event, onSubmit);
          if (
            event.key !== "Tab" ||
            event.defaultPrevented ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.nativeEvent.isComposing
          )
            return;
          if (
            !(event.target instanceof Node) ||
            !event.currentTarget.contains(event.target)
          )
            return;
          const focusable = focusableControls(event.currentTarget);
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="nerilo-dialog-header">
          <h2 id={titleId}>{title}</h2>
          <Button
            label="Close dialog"
            isIconOnly
            icon={<X size={17} />}
            variant="ghost"
            size="sm"
            onClick={onClose}
          />
        </header>
        <div className="nerilo-dialog-body">
          <div className="form-stack">{children}</div>
        </div>
        {footer && <footer className="nerilo-dialog-footer">{footer}</footer>}
      </div>
    </Dialog>
  );
}
export type Editor =
  | { kind: "project"; value?: Project }
  | { kind: "preset"; value?: Preset }
  | { kind: "note"; value?: Note };
export function EditorModal({
  editor,
  snapshot,
  onClose,
  onSaved,
}: {
  editor: Editor;
  snapshot: Snapshot;
  onClose: () => void;
  onSaved: (result: unknown) => void;
}) {
  const [name, setName] = useState(
    editor.kind === "note"
      ? (editor.value?.title ?? "")
      : (editor.value?.name ?? ""),
  );
  const [path, setPath] = useState(
    editor.kind === "project" ? (editor.value?.path ?? "") : "",
  );
  const [source, setSource] = useState(
    editor.kind === "project" && editor.value && !editor.value.repository
      ? "local"
      : "github",
  );
  const [repository, setRepository] = useState(
    editor.kind === "project" ? (editor.value?.repository ?? "") : "",
  );
  const [branch, setBranch] = useState(
    editor.kind === "project" && editor.value?.repository
      ? editor.value.branch
      : "",
  );
  const [setup, setSetup] = useState(
    editor.kind === "project" ? (editor.value?.setup ?? "") : "",
  );
  const [verify, setVerify] = useState(
    editor.kind === "project" ? (editor.value?.verify ?? "") : "",
  );
  const [content, setContent] = useState(
    editor.kind === "preset"
      ? (editor.value?.instructions ?? "")
      : editor.kind === "note"
        ? (editor.value?.content ?? "")
        : "",
  );
  const [provider, setProvider] = useState<Provider>(
    editor.kind === "preset" ? (editor.value?.provider ?? "codex") : "codex",
  );
  const [model, setModel] = useState(
    editor.kind === "preset" ? (editor.value?.model ?? "") : "",
  );
  const [projectId, setProjectId] = useState(
    editor.kind === "note" ? (editor.value?.projectId ?? "all") : "all",
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nouns = {
    project: "project",
    preset: "agent preset",
    note: "reference note",
  };
  const save = async () => {
    if (
      busy ||
      (editor.kind === "project"
        ? !(source === "github" ? repository : path).trim()
        : !name.trim())
    )
      return;
    setBusy(true);
    setError("");
    try {
      const input =
        editor.kind === "project"
          ? {
              name:
                name.trim() ||
                projectName(source === "github" ? repository : path),
              path: source === "local" ? path : "",
              repository: source === "github" ? repository : null,
              branch: source === "github" ? branch : undefined,
              setup,
              verify,
            }
          : editor.kind === "preset"
            ? { name, instructions: content, provider, model }
            : {
                title: name,
                content,
                projectId: projectId === "all" ? null : projectId,
              };
      const result = await mutate(
        `${editor.kind === "project" ? "projects" : editor.kind === "preset" ? "presets" : "notes"}${editor.value ? `/${editor.value.id}` : ""}`,
        input,
      );
      onSaved(result);
      onClose();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${editor.value ? "Edit" : "Add"} ${nouns[editor.kind]}`}
      onSubmit={() => void save()}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Button
            label="Cancel"
            variant="ghost"
            size="sm"
            isDisabled={busy}
            onClick={onClose}
          />
          <Button
            label={editor.value ? "Save changes" : `Add ${nouns[editor.kind]}`}
            variant="primary"
            size="sm"
            isLoading={busy}
            isDisabled={
              editor.kind === "project"
                ? !(source === "github" ? repository : path).trim()
                : !name.trim()
            }
            onClick={() => void save()}
          />
        </>
      }
    >
      {error && (
        <div role="alert" className="error-note">
          {error}
        </div>
      )}
      {editor.kind !== "project" && (
        <TextInput
          label={editor.kind === "note" ? "Title" : "Name"}
          value={name}
          onChange={setName}
          hasAutoFocus
        />
      )}
      {editor.kind === "project" ? (
        <>
          <div className="project-source-picker">
            <SegmentedControl
              label="Project source"
              value={source}
              onChange={setSource}
              isDisabled={busy}
            >
              <SegmentedControlItem
                value="github"
                label="GitHub"
                icon={<Github size={14} />}
              />
              <SegmentedControlItem
                value="local"
                label="Local folder"
                icon={<Folder size={14} />}
              />
            </SegmentedControl>
          </div>
          {source === "github" ? (
            <TextInput
              label="Repository"
              value={repository}
              onChange={setRepository}
              placeholder="owner/repository or a GitHub URL"
              description="Uses your GitHub login. No local clone needed."
              hasAutoFocus
            />
          ) : (
            <TextInput
              label="Repository folder"
              value={path}
              onChange={setPath}
              placeholder="/Users/you/Developer/my-project"
              description="Choose an existing Git repository with at least one commit."
              hasAutoFocus
            />
          )}
          <TextInput
            label="Name"
            value={name}
            onChange={setName}
            isOptional
            placeholder={
              (source === "github" ? repository : path).trim()
                ? projectName(source === "github" ? repository : path)
                : "Use the repository name"
            }
          />
          <details>
            <summary>Project options</summary>
            <div className="form-stack">
              {source === "github" && (
                <TextInput
                  label="Branch"
                  value={branch}
                  onChange={setBranch}
                  placeholder="Default branch"
                  isOptional
                />
              )}
              <TextInput
                label="Preparation command"
                value={setup}
                onChange={setSetup}
                placeholder="bun install --frozen-lockfile"
                description="Before the agent starts."
              />
              <TextInput
                label="Verification command"
                value={verify}
                onChange={setVerify}
                placeholder="bun test"
                description="After each successful turn."
              />
            </div>
          </details>
        </>
      ) : editor.kind === "preset" ? (
        <>
          <Selector
            label="Provider"
            value={provider}
            options={[
              { value: "codex", label: "Codex" },
              { value: "claude", label: "Claude Code" },
            ]}
            onChange={(v) => setProvider(v as Provider)}
          />
          <TextInput
            label="Model"
            value={model}
            onChange={setModel}
            placeholder="Use the agent default"
            isOptional
          />
          <TextArea
            label="Instructions"
            value={content}
            onChange={setContent}
            rows={7}
            description="Applied at the start of each turn using this preset."
          />
        </>
      ) : (
        <>
          <Selector
            label="Available to"
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: "all", label: "All projects" },
              ...snapshot.projects
                .filter((p) => !p.archived)
                .map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <TextArea
            label="Reference content"
            value={content}
            onChange={setContent}
            rows={9}
            description="Included as reference context in matching tasks."
          />
        </>
      )}
    </Modal>
  );
}
