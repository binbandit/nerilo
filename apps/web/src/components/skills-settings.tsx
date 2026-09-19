"use client";
import { useRef, useState } from "react";
import {
  ChevronDown,
  FileText,
  FolderOpen,
  Github,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Switch } from "@astryxdesign/core/Switch";
import {
  agentSkillsSchema,
  parseAgentSkill,
  type AgentSkill,
} from "@nerilo/protocol";
import { Modal } from "@/components/editors";
import { Button, TextArea } from "@/components/ui";
import { GithubSkillImport } from "@/components/github-skill-import";
import { importSkillFiles } from "@/lib/skill-import";
import "./skills-settings.css";

const TEMPLATE = `---
name: my-skill
description: Describe what this skill does and when to use it.
---

# My skill

Add instructions for the agent here.
`;

export function SkillsSettings({
  skills,
  busy,
  save,
}: {
  skills: AgentSkill[];
  busy: boolean;
  save: (skills: AgentSkill[]) => Promise<boolean>;
}) {
  const [editor, setEditor] = useState<{ skill?: AgentSkill } | null>(null);
  const [removing, setRemoving] = useState<AgentSkill | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const skillButtons = useRef(new Map<string, HTMLButtonElement>());
  const locked = busy || saving;
  function restoreFocus(id?: string) {
    requestAnimationFrame(() =>
      (id
        ? (skillButtons.current.get(id) ?? addButton.current)
        : addButton.current
      )?.focus(),
    );
  }
  async function update(next: AgentSkill[]) {
    if (busy || inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const success = await save(next);
      if (success) setNotice("Saved.");
      else setError("Could not save skills. Please try again.");
      return success;
    } catch {
      setError("Could not save skills. Please try again.");
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <header className="preferences-heading skills-settings-heading">
        <div>
          <h2>Skills</h2>
          <p>Reusable instructions and resources for your agents.</p>
        </div>
        <Button
          ref={addButton}
          label="Add skill"
          size="sm"
          icon={<Plus size={14} />}
          isDisabled={locked}
          onClick={() => {
            setError("");
            setEditor({});
          }}
        />
      </header>
      <div className="preferences-rows">
        {skills.length ? (
          skills.map((skill) => (
            <div className="preferences-row skills-settings-row" key={skill.id}>
              <div className="preferences-row-copy">
                <h3>{skill.name}</h3>
                <p>{skill.description}</p>
              </div>
              <div className="preferences-row-actions">
                <Switch
                  label={`Enable ${skill.name}`}
                  isLabelHidden
                  size="sm"
                  value={skill.enabled}
                  isDisabled={locked}
                  onChange={(enabled) =>
                    void update(
                      skills.map((item) =>
                        item.id === skill.id ? { ...item, enabled } : item,
                      ),
                    )
                  }
                />
                <DropdownMenu
                  button={{
                    ref: (element) => {
                      if (element) skillButtons.current.set(skill.id, element);
                      else skillButtons.current.delete(skill.id);
                    },
                    label: `${skill.name} options`,
                    isIconOnly: true,
                    icon: <MoreHorizontal size={16} />,
                    variant: "ghost",
                    size: "sm",
                    isDisabled: locked,
                  }}
                  alignment="end"
                  hasChevron={false}
                  items={[
                    {
                      label: "Edit skill…",
                      onClick: () => {
                        setError("");
                        setEditor({ skill });
                      },
                    },
                    { type: "divider" },
                    {
                      label: "Remove skill…",
                      onClick: () => {
                        setError("");
                        setRemoving(skill);
                      },
                    },
                  ]}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="skills-settings-empty">No skills yet.</p>
        )}
      </div>
      {skills.length > 0 && (
        <p className="preferences-footnote">
          Enabled by default. Override per task; changes apply next turn.
        </p>
      )}
      {error && !editor && !removing && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <span className="skills-settings-notice" role="status">
        {notice}
      </span>
      {editor && (
        <SkillDialog
          skill={editor.skill}
          skills={skills}
          busy={locked}
          error={error}
          save={update}
          onClose={() => {
            if (!inFlight.current) {
              setEditor(null);
              restoreFocus(editor.skill?.id);
            }
          }}
        />
      )}
      {removing && (
        <Modal
          title={`Remove ${removing.name}?`}
          width={420}
          onClose={() => {
            if (!inFlight.current) {
              setRemoving(null);
              restoreFocus(removing.id);
            }
          }}
          footer={
            <>
              <Button
                label="Cancel"
                variant="ghost"
                isDisabled={locked}
                onClick={() => {
                  setRemoving(null);
                  restoreFocus(removing.id);
                }}
              />
              <Button
                label="Remove skill"
                isDisabled={locked}
                isLoading={saving}
                onClick={() => {
                  void update(
                    skills.filter((skill) => skill.id !== removing.id),
                  ).then((success) => {
                    if (success) {
                      setRemoving(null);
                      restoreFocus();
                    }
                  });
                }}
              />
            </>
          }
        >
          <p>
            Removes this skill from Nerilo. Running turns keep their current
            skills.
          </p>
          {error && (
            <p role="alert" className="error-note">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

function SkillDialog({
  skill,
  skills,
  busy,
  error,
  save,
  onClose,
}: {
  skill?: AgentSkill;
  skills: AgentSkill[];
  busy: boolean;
  error: string;
  save: (skills: AgentSkill[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [id] = useState(() => skill?.id ?? crypto.randomUUID());
  const [manifest, setManifest] = useState(
    skill?.files.find((file) => file.path === "SKILL.md")?.content ?? TEMPLATE,
  );
  const [supporting, setSupporting] = useState(
    skill?.files.filter((file) => file.path !== "SKILL.md") ?? [],
  );
  const [issue, setIssue] = useState("");
  const [github, setGithub] = useState(false);
  const [source, setSource] = useState(skill?.source);
  const [importing, setImporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);
  const locked = busy || importing;
  async function importFiles(files: File[], folder: boolean) {
    setImporting(true);
    setIssue("");
    try {
      const imported = await importSkillFiles(files, folder);
      const next = parseAgentSkill({
        id,
        enabled: skill?.enabled ?? true,
        files: folder ? imported : [...imported, ...supporting],
      });
      if (folder) setSource(undefined);
      setManifest(next.files.find((file) => file.path === "SKILL.md")!.content);
      setSupporting(next.files.filter((file) => file.path !== "SKILL.md"));
    } catch (reason) {
      setIssue(
        reason instanceof Error
          ? reason.message
          : "Could not import this skill.",
      );
    } finally {
      setImporting(false);
    }
  }
  async function submit() {
    if (locked) return;
    setIssue("");
    try {
      const next = parseAgentSkill({
        id,
        enabled: skill?.enabled ?? true,
        source,
        files: [
          { path: "SKILL.md", content: manifest, encoding: "utf8" },
          ...supporting,
        ],
      });
      const result = agentSkillsSchema.safeParse(
        skill
          ? skills.map((item) => (item.id === id ? next : item))
          : [...skills, next],
      );
      if (!result.success) {
        setIssue(
          result.error.issues[0]?.message ?? "Check the skill configuration.",
        );
        return;
      }
      if (await save(result.data)) onClose();
    } catch (reason) {
      setIssue(
        reason instanceof Error
          ? reason.message
          : "Check the skill configuration.",
      );
    }
  }
  if (github)
    return (
      <GithubSkillImport
        onClose={() => setGithub(false)}
        onImport={(imported) => {
          setManifest(
            imported.files.find((file) => file.path === "SKILL.md")!.content,
          );
          setSupporting(
            imported.files.filter((file) => file.path !== "SKILL.md"),
          );
          setSource(imported.source);
          setIssue("");
          setGithub(false);
        }}
      />
    );
  return (
    <Modal
      title={skill ? "Edit skill" : "Add skill"}
      width={560}
      onClose={() => {
        if (!importing) onClose();
      }}
      onSubmit={() => void submit()}
      footer={
        <>
          <Button
            label="Cancel"
            variant="ghost"
            isDisabled={locked}
            onClick={onClose}
          />
          <Button
            label={skill ? "Save changes" : "Add skill"}
            isDisabled={locked}
            isLoading={busy}
            onClick={() => void submit()}
          />
        </>
      }
    >
      <div className="skills-import-actions">
        <Button
          label="GitHub…"
          icon={<Github size={14} />}
          size="sm"
          variant="secondary"
          isDisabled={locked}
          onClick={() => setGithub(true)}
        />
        <Button
          label="Import SKILL.md"
          icon={<FileText size={14} />}
          size="sm"
          variant="secondary"
          isDisabled={locked}
          onClick={() => fileInput.current?.click()}
        />
        <Button
          label={supporting.length ? "Replace folder…" : "Import folder…"}
          icon={<FolderOpen size={14} />}
          size="sm"
          variant="ghost"
          isDisabled={locked}
          onClick={() => folderInput.current?.click()}
        />
        <input
          ref={fileInput}
          type="file"
          accept=".md"
          hidden
          aria-label="Import SKILL.md file"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length) void importFiles(files, false);
          }}
        />
        <input
          ref={folderInput}
          type="file"
          {...{ webkitdirectory: "" }}
          multiple
          hidden
          aria-label="Import skill folder"
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = "";
            if (files.length) void importFiles(files, true);
          }}
        />
      </div>
      {source && (
        <p className="skills-source">
          Imported from{" "}
          <a
            href={`https://github.com/${source.repository}/tree/${source.revision}/${source.path.split("/").map(encodeURIComponent).join("/")}`}
            target="_blank"
            rel="noreferrer"
          >
            {source.repository}
          </a>{" "}
          · {source.revision.slice(0, 7)}
        </p>
      )}
      <div className="skills-manifest">
        <TextArea
          label="SKILL.md"
          value={manifest}
          onChange={setManifest}
          rows={13}
          hasAutoFocus
          isDisabled={locked}
          description="Name and description come from the header. Import a folder to include scripts and other resources."
        />
      </div>
      {supporting.length > 0 && (
        <details className="skills-files">
          <summary>
            <ChevronDown size={13} />
            {supporting.length} supporting{" "}
            {supporting.length === 1 ? "file" : "files"}
          </summary>
          <ul>
            {supporting.map((file) => (
              <li key={file.path}>
                <FileText size={13} />
                <span>{file.path}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {(issue || error) && (
        <p role="alert" className="error-note">
          {issue || error}
        </p>
      )}
    </Modal>
  );
}
