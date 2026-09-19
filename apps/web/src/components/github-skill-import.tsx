"use client";
import { useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Folder, Github } from "lucide-react";
import {
  agentSkillSchema,
  githubSkillDiscoverySchema,
  type AgentSkill,
  type GithubSkillDiscovery,
} from "@nerilo/protocol";
import { Modal } from "@/components/editors";
import { Button, TextInput } from "@/components/ui";
import { mutate } from "@/lib/api";

export function GithubSkillImport({
  onClose,
  onImport,
}: {
  onClose: () => void;
  onImport: (skill: AgentSkill) => void;
}) {
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [query, setQuery] = useState("");
  const [discovery, setDiscovery] = useState<GithubSkillDiscovery | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingPath, setLoadingPath] = useState<string | null>(null);
  const [error, setError] = useState("");
  const flight = useRef(false);
  async function browse() {
    if (flight.current || !url.trim()) return;
    flight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = githubSkillDiscoverySchema.parse(
        await mutate("skills/discover", {
          url: url.trim(),
          ref: ref.trim() || undefined,
        }),
      );
      setDiscovery(result);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not read this repository.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  async function choose(path: string) {
    if (!discovery || flight.current) return;
    flight.current = true;
    setBusy(true);
    setLoadingPath(path);
    setError("");
    try {
      const skill = agentSkillSchema.parse(
        await mutate("skills/import", {
          repository: discovery.repository,
          revision: discovery.revision,
          path,
        }),
      );
      onImport(skill);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not import this skill.",
      );
    } finally {
      flight.current = false;
      setBusy(false);
      setLoadingPath(null);
    }
  }
  const filtered =
    discovery?.skills.filter((skill) =>
      `${skill.name ?? ""} ${skill.path}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    ) ?? [];
  return (
    <Modal
      title="Import from GitHub"
      width={480}
      onClose={() => {
        if (!flight.current) onClose();
      }}
      onSubmit={() => {
        if (!discovery) void browse();
      }}
      footer={
        <>
          {discovery && (
            <Button
              label="Change repository"
              variant="ghost"
              icon={<ArrowLeft size={14} />}
              isDisabled={busy}
              onClick={() => {
                setDiscovery(null);
                setQuery("");
                setError("");
              }}
            />
          )}
          <Button
            label="Cancel"
            variant="ghost"
            isDisabled={busy}
            onClick={onClose}
          />
          {!discovery && (
            <Button
              label="Find skills"
              isLoading={busy}
              isDisabled={!url.trim() || busy}
              onClick={() => void browse()}
            />
          )}
        </>
      }
    >
      {!discovery ? (
        <>
          <TextInput
            label="Repository"
            value={url}
            onChange={setUrl}
            placeholder="https://github.com/owner/repository"
            hasAutoFocus
            isDisabled={busy}
          />
          <details className="skills-files">
            <summary>
              <ChevronDown size={13} />
              Branch, tag or commit
            </summary>
            <TextInput
              label="Revision"
              value={ref}
              onChange={setRef}
              placeholder="Default branch"
              isDisabled={busy}
            />
          </details>
          <p className="preferences-footnote">
            Choose a skill, then review its instructions before adding it.
          </p>
        </>
      ) : (
        <>
          <div className="skill-repository-heading">
            <Github size={16} />
            <span>{discovery.repository}</span>
            <code title={discovery.revision}>
              {discovery.revision.slice(0, 7)}
            </code>
          </div>
          {discovery.skills.length > 6 && (
            <TextInput
              label="Search skills"
              value={query}
              onChange={setQuery}
              placeholder="Filter by name or folder"
              hasAutoFocus
              isDisabled={busy}
            />
          )}
          <div
            className="skill-repository-results"
            aria-label="Repository skills"
          >
            {filtered.map((skill) => (
              <Button
                key={skill.path}
                label={
                  skill.path ||
                  skill.name ||
                  discovery.repository.split("/").at(-1) ||
                  "Root skill"
                }
                icon={<Folder size={15} />}
                variant="ghost"
                className="skill-repository-option"
                isDisabled={busy}
                isLoading={busy && loadingPath === skill.path}
                onClick={() => void choose(skill.path)}
              />
            ))}
            {!filtered.length && (
              <p>
                {discovery.skills.length
                  ? "No matching skills."
                  : "No SKILL.md files found in this repository."}
              </p>
            )}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
    </Modal>
  );
}
