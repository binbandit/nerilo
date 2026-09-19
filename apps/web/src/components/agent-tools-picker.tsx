"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Wrench } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuDivider,
  DropdownMenuItem,
} from "@astryxdesign/core/DropdownMenu";
import {
  resolveAgentTools,
  type AgentSkill,
  type AgentTools,
  type McpServer,
} from "@nerilo/protocol";
import "./agent-tools-picker.css";

export function AgentToolsPicker({
  skills,
  servers,
  value,
  onChange,
  running = false,
}: {
  skills: AgentSkill[];
  servers: McpServer[];
  value: AgentTools;
  onChange: (value: AgentTools) => void | Promise<void>;
  running?: boolean;
}) {
  const [selected, setSelected] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);
  useEffect(() => setSelected(value), [value]);
  const defaults = selected.skillIds === null && selected.mcpServerIds === null;
  const { skills: selectedSkills, mcpServers: selectedServers } =
    resolveAgentTools({ skills, mcpServers: servers }, selected);
  const count = selectedSkills.length + selectedServers.length;
  if (!skills.length && !servers.length && defaults) return null;

  const save = async (next: AgentTools) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    const available: AgentTools = {
      skillIds:
        next.skillIds?.filter((id) =>
          skills.some((skill) => skill.id === id),
        ) ?? null,
      mcpServerIds:
        next.mcpServerIds?.filter((id) =>
          servers.some((server) => server.id === id),
        ) ?? null,
    };
    try {
      await onChange(available);
      setSelected(available);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const toggle = (
    group: "skillIds" | "mcpServerIds",
    id: string,
    enabled: boolean,
  ) => {
    const configured = group === "skillIds" ? skills : servers;
    const current = selected[group];
    const ids = configured
      .filter((item) =>
        current === null ? item.enabled : current.includes(item.id),
      )
      .map((item) => item.id);
    void save({
      ...selected,
      [group]: enabled ? [...ids, id] : ids.filter((value) => value !== id),
    });
  };
  return (
    <div
      className="agent-tools-picker"
      onClick={(event) => event.stopPropagation()}
    >
      <DropdownMenu
        placement="above"
        alignment="start"
        menuWidth={272}
        button={{
          label: defaults ? "Tools" : `Tools · ${count}`,
          "aria-label": `Agent tools: ${count} enabled${defaults ? ", using defaults" : ""}`,
          "aria-busy": busy,
          icon: busy ? <span className="task-spinner" /> : <Wrench size={14} />,
          variant: "ghost",
          size: "sm",
          className: "model-picker-trigger",
        }}
      >
        {skills.length > 0 && <div className="agent-tools-heading">Skills</div>}
        {skills.map((skill) => (
          <DropdownMenuCheckboxItem
            key={`skill-${skill.id}`}
            label={<span title={skill.description}>{skill.name}</span>}
            className="agent-tools-option"
            value={selectedSkills.some((item) => item.id === skill.id)}
            isDisabled={!skill.enabled}
            description={!skill.enabled ? "Disabled in Settings" : undefined}
            onChange={(enabled) => toggle("skillIds", skill.id, enabled)}
          />
        ))}
        {servers.length > 0 && (
          <div className="agent-tools-heading">MCP servers</div>
        )}
        {servers.map((server) => (
          <DropdownMenuCheckboxItem
            key={`mcp-${server.id}`}
            label={server.name}
            className="agent-tools-option"
            value={selectedServers.some((item) => item.id === server.id)}
            isDisabled={!server.enabled}
            description={!server.enabled ? "Disabled in Settings" : undefined}
            onChange={(enabled) => toggle("mcpServerIds", server.id, enabled)}
          />
        ))}
        {(skills.length > 0 || servers.length > 0) && <DropdownMenuDivider />}
        <DropdownMenuItem
          label="Use defaults"
          className="agent-tools-option"
          isDisabled={busy}
          endContent={
            <span className="model-menu-check" aria-hidden="true">
              {defaults && <Check size={13} />}
            </span>
          }
          onClick={() => void save({ skillIds: null, mcpServerIds: null })}
        />
        <DropdownMenuItem
          label="None"
          className="agent-tools-option"
          isDisabled={busy}
          onClick={() => void save({ skillIds: [], mcpServerIds: [] })}
        />
        {running && (
          <div className="model-menu-hint">Changes apply next turn</div>
        )}
      </DropdownMenu>
      {error && (
        <div role="alert" className="model-menu-error">
          {error}
        </div>
      )}
    </div>
  );
}
