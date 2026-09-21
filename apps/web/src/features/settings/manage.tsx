"use client";
import {
  providerNames,
  isMultiProviderHarness,
  modelProviderSchema,
  modelProviderNames,
  type ModelProvider,
} from "@nerilo/protocol";

import { useState } from "react";
import { Plus, BookOpen, Trash2, Pencil } from "lucide-react";
import type { Snapshot, Provider, Settings } from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Button, Heading, Text, TextInput, Selector } from "@/components/ui/ui";
import { Modal, type Editor } from "@/components/editors/editors";

import { AgentLogin } from "@/features/settings/claude-login";
import { ProjectList } from "@/features/projects/project-list";
import type { ProjectAction } from "@/features/projects/project-action-dialog";
import { SettingsPanel } from "@/features/settings/settings-panel";
import { ProviderIcon } from "@/components/ui/provider-icon";
import "@/features/settings/manage.css";

export function Manage({
  view,
  data,
  edit,
  onProject,
  onProjectAction,
}: {
  view: "projects" | "agents" | "library" | "settings";
  data: Snapshot;
  edit: (e: Editor) => void;

  onProject: (id: string) => void;
  onProjectAction: (value: ProjectAction) => void;
}) {
  const {
    mutateAsync: send,
    isPending: busy,
    error: failure,
  } = useApiMutation("settings");
  const error = failure?.message ?? "";
  const [provider, setProvider] = useState<Provider | null>(null);
  const [modelProvider, setModelProvider] =
    useState<ModelProvider>("anthropic");
  const [key, setKey] = useState("");
  const [loginProvider, setLoginProvider] = useState<Provider | null>(null);
  const [remove, setRemove] = useState<{ path: string; name: string } | null>(
    null,
  );
  const act = async (path: string, body: unknown = {}) => {
    try {
      await send({ path, body });
      return true;
    } catch {
      return false;
    }
  };
  const titles = {
    projects: "Projects",
    agents: "Agents",
    library: "Library",
    settings: "Settings",
  };
  const changeSettings = (input: Partial<Settings>) =>
    void act("settings", input);
  const saveConnection = async () => {
    if (busy || !provider || !key.trim()) return;
    if (
      await act("connections", { provider, action: "key", key, modelProvider })
    ) {
      setProvider(null);
      setKey("");
    }
  };
  return (
    <div
      className={`manage-content ${view === "settings" ? "settings-page" : ""}`}
    >
      {loginProvider && (
        <AgentLogin
          provider={loginProvider}
          onClose={() => setLoginProvider(null)}
          onConnected={() => {
            setLoginProvider(null);
          }}
        />
      )}
      <div className="manage-heading">
        <div className="welcome">
          <Heading level={1}>{titles[view]}</Heading>
        </div>
        {view !== "settings" && (
          <Button
            label={
              view === "projects"
                ? "Add project"
                : view === "agents"
                  ? "Add agent"
                  : "Add note"
            }
            variant="primary"
            size="sm"
            icon={<Plus size={16} />}
            onClick={() =>
              edit({
                kind:
                  view === "projects"
                    ? "project"
                    : view === "agents"
                      ? "preset"
                      : "note",
              })
            }
          />
        )}
      </div>
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
      {view === "projects" ? (
        <ProjectList
          data={data}
          edit={edit}
          onProject={onProject}
          onAction={onProjectAction}
        />
      ) : view === "agents" ? (
        <div className="management-list">
          {data.presets.map((p) => (
            <article className="management-row" key={p.id}>
              <div className="management-icon">
                <ProviderIcon provider={p.provider} size={20} />
              </div>
              <div className="management-copy">
                <Heading level={2}>{p.name}</Heading>
                <Text type="supporting">
                  {providerNames[p.provider]} ·{" "}
                  {p.model || "Agent default model"}
                </Text>
                <Text as="p" color="secondary" className="management-preview">
                  {p.instructions}
                </Text>
              </div>
              <Button
                label={`Edit ${p.name}`}
                isIconOnly
                size="sm"
                variant="ghost"
                icon={<Pencil size={15} />}
                onClick={() => edit({ kind: "preset", value: p })}
              />
            </article>
          ))}
        </div>
      ) : view === "library" ? (
        <div className="management-list">
          {data.notes.length ? (
            data.notes.map((n) => (
              <article className="management-row" key={n.id}>
                <div className="management-icon">
                  <BookOpen size={18} />
                </div>
                <div className="management-copy">
                  <Heading level={2}>{n.title}</Heading>
                  <Text type="supporting">
                    {data.projects.find((p) => p.id === n.projectId)?.name ??
                      "All projects"}
                  </Text>
                  <Text as="p" color="secondary" className="management-preview">
                    {n.content.slice(0, 220)}
                    {n.content.length > 220 ? "…" : ""}
                  </Text>
                </div>
                <div className="row">
                  <Button
                    label={`Edit ${n.title}`}
                    isDisabled={
                      data.projects.find((p) => p.id === n.projectId)?.archived
                    }
                    isIconOnly
                    size="sm"
                    icon={<Pencil size={16} />}
                    variant="ghost"
                    onClick={() => edit({ kind: "note", value: n })}
                  />
                  <Button
                    label={`Delete ${n.title}`}
                    isIconOnly
                    size="sm"
                    icon={<Trash2 size={16} />}
                    variant="ghost"
                    onClick={() =>
                      setRemove({ path: `notes/${n.id}`, name: n.title })
                    }
                  />
                </div>
              </article>
            ))
          ) : (
            <div className="empty-list">
              <BookOpen size={28} />
              <Text color="secondary">
                Save conventions, useful context, and instructions your agents
                should remember.
              </Text>
            </div>
          )}
        </div>
      ) : (
        <SettingsPanel
          data={data}
          busy={busy}
          act={act}
          changeSettings={changeSettings}
          addKey={(value) => {
            setProvider(value);
            setModelProvider("anthropic");
            setKey("");
          }}
          signIn={setLoginProvider}
          disconnect={(value) =>
            setRemove({ path: "connections", name: value })
          }
        />
      )}
      {provider && (
        <Modal
          title={`Connect ${providerNames[provider]}`}
          onSubmit={() => void saveConnection()}
          onClose={() => {
            if (busy) return;
            setProvider(null);
            setKey("");
          }}
          footer={
            <>
              <Button
                label="Cancel"
                isDisabled={busy}
                onClick={() => {
                  setProvider(null);
                  setKey("");
                }}
              />
              <Button
                label="Save connection"
                variant="primary"
                isDisabled={busy || !key.trim()}
                isLoading={busy}
                onClick={() => void saveConnection()}
              />
            </>
          }
        >
          {error && (
            <div role="alert" className="error-note">
              {error}
            </div>
          )}
          {isMultiProviderHarness(provider) && (
            <Selector
              label="Model provider"
              value={modelProvider}
              onChange={(value) =>
                setModelProvider(modelProviderSchema.parse(value))
              }
              options={modelProviderSchema.options.map((value) => ({
                value,
                label: modelProviderNames[value],
              }))}
            />
          )}
          <TextInput
            label="API key"
            value={key}
            onChange={setKey}
            type="password"
            hasAutoFocus
          />
          <Text type="supporting">
            Stored in macOS Keychain and passed privately to the selected agent.
            The app never returns saved keys to the browser.
          </Text>
        </Modal>
      )}
      {remove && (
        <Modal
          title={
            remove.path === "connections"
              ? "Disconnect this agent?"
              : "Delete this note?"
          }
          onClose={() => setRemove(null)}
          footer={
            <>
              <Button label="Cancel" onClick={() => setRemove(null)} />
              <Button
                label={
                  remove.path === "connections" ? "Disconnect" : "Delete note"
                }
                variant="destructive"
                isLoading={busy}
                onClick={() =>
                  void (async () => {
                    if (
                      await act(
                        remove.path,
                        remove.path === "connections"
                          ? { provider: remove.name, action: "disconnect" }
                          : { remove: true },
                      )
                    )
                      setRemove(null);
                  })()
                }
              />
            </>
          }
        >
          {error && (
            <div role="alert" className="error-note">
              {error}
            </div>
          )}
          <Text as="p">
            {remove.path === "connections"
              ? remove.name === "claude" &&
                data.runtime.connections.claude.source ===
                  "Imported Claude Code login"
                ? "This removes Nerilo’s imported login. Your Claude Code login on this device is kept. Finish running Claude tasks before disconnecting."
                : remove.name === "claude" &&
                    data.runtime.connections.claude.source ===
                      "Claude Code login"
                  ? "This signs Claude Code out of its container environment. Running Claude tasks may also need you to sign in again."
                  : "Future turns will need a new connection. Running tasks keep their current credentials."
              : `Delete “${remove.name}” from the library? It will no longer be included in future turns.`}
          </Text>
        </Modal>
      )}
    </div>
  );
}
