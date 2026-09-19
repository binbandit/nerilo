"use client";
import { useState } from "react";
import {
  BookOpen,
  Box,
  Cable,
  Check,
  ChevronDown,
  Monitor,
  MoreHorizontal,
  Palette,
  Keyboard,
  Shield,
  Plug,
} from "lucide-react";
import {
  DropdownMenu,
  type DropdownMenuOption,
} from "@astryxdesign/core/DropdownMenu";
import {
  matchesShortcut,
  type Provider,
  type Settings,
  type Snapshot,
  type ShortcutAction,
} from "@nerilo/protocol";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/lib/shortcut-preferences";
import { Button, Selector } from "@/components/ui";
import { ProviderIcon } from "@/components/provider-icon";
import { SandboxControls } from "@/components/sandbox-controls";
import { KeyboardSettings } from "@/components/keyboard-settings";
import { SkillsSettings } from "@/components/skills-settings";
import { McpSettings } from "@/components/mcp-settings";
import { MachinesSettings } from "@/components/machine-controls";
import "./settings-panel.css";

const sections = [
  { id: "machines", label: "Machines", icon: Monitor },
  { id: "connections", label: "Connections", icon: Cable },
  { id: "skills", label: "Skills", icon: BookOpen },
  { id: "mcp", label: "MCP servers", icon: Plug },
  { id: "environment", label: "Environment", icon: Box },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "keyboard", label: "Keyboard", icon: Keyboard },
] as const;

export function SettingsPanel({
  data,
  busy,
  act,
  changeSettings,
  addKey,
  signIn,
  disconnect,
  refresh,
}: {
  data: Snapshot;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<boolean>;
  changeSettings: (value: Partial<Settings>) => void;
  addKey: (provider: Provider) => void;
  signIn: () => void;
  disconnect: (provider: Provider) => void;
  refresh: () => void;
}) {
  const [section, setSection] =
    useState<(typeof sections)[number]["id"]>("connections");
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  return (
    <div className="preferences-layout">
      <div className="preferences-mobile-navigation">
        <DropdownMenu
          button={{
            label:
              sections.find((item) => item.id === section)?.label ?? "Settings",
            "aria-label": "Settings section",
            variant: "ghost",
            size: "sm",
          }}
          alignment="start"
          menuWidth={220}
          items={sections.map(({ id, label, icon: Icon }) => ({
            label,
            icon: section === id ? <Check size={15} /> : <Icon size={15} />,
            onClick: () => setSection(id),
          }))}
        />
      </div>
      <nav className="preferences-navigation" aria-label="Settings sections">
        {sections.map(({ id, label, icon: Icon }, index) => (
          <button
            key={id}
            type="button"
            aria-current={section === id ? "page" : undefined}
            onClick={() => setSection(id)}
            onKeyDown={(event) => {
              const matches = (action: ShortcutAction) =>
                matchesShortcut(event, action, bindings, mac);
              const next = matches("row-first")
                ? 0
                : matches("row-last")
                  ? sections.length - 1
                  : matches("row-next") || matches("row-expand")
                    ? (index + 1) % sections.length
                    : matches("row-previous") || matches("row-collapse")
                      ? (index + sections.length - 1) % sections.length
                      : null;
              if (next === null) return;
              event.preventDefault();
              setSection(sections[next].id);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <section
        className="preferences-content"
        aria-label={sections.find((item) => item.id === section)?.label}
      >
        {section === "machines" ? (
          <MachinesSettings />
        ) : section === "connections" ? (
          <>
            <header className="preferences-heading">
              <h2>Connections</h2>
              <p>Your agents, running with your accounts.</p>
            </header>
            <div className="preferences-rows">
              {(["codex", "claude"] as const).map((provider) => {
                const connection = data.runtime.connections[provider];
                const name = provider === "codex" ? "Codex" : "Claude Code";
                const importLogin = () => {
                  void act("connections", { provider, action: "import" });
                };
                const options: DropdownMenuOption[] = [
                  ...(connection.canImport
                    ? [
                        {
                          label: connection.source.startsWith("Imported")
                            ? "Refresh existing login"
                            : "Use existing login",
                          onClick: importLogin,
                          isDisabled: busy,
                        },
                      ]
                    : []),
                  ...(provider === "claude"
                    ? [
                        {
                          label: "Sign in to Claude Code",
                          onClick: signIn,
                          isDisabled: busy,
                        },
                      ]
                    : []),
                  {
                    label: "Use an API key…",
                    onClick: () => addKey(provider),
                    isDisabled: busy,
                  },
                  ...(connection.ready
                    ? [
                        { type: "divider" as const },
                        {
                          label: "Disconnect",
                          onClick: () => disconnect(provider),
                          isDisabled: busy,
                        },
                      ]
                    : []),
                ];
                return (
                  <div className="preferences-provider" key={provider}>
                    <span
                      className="preferences-provider-icon"
                      aria-hidden="true"
                    >
                      <ProviderIcon provider={provider} size={24} />
                    </span>
                    <div className="preferences-row-copy">
                      <h3>{name}</h3>
                      <p>
                        {connection.ready
                          ? connection.source
                          : connection.canImport
                            ? "Existing login available"
                            : "Not connected"}
                      </p>
                    </div>
                    <div className="preferences-row-actions">
                      {connection.ready ? (
                        <span className="preferences-status">
                          <span />
                          Connected
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          label={
                            connection.canImport
                              ? "Use existing login"
                              : "Connect"
                          }
                          isDisabled={busy}
                          onClick={
                            connection.canImport
                              ? importLogin
                              : provider === "claude"
                                ? signIn
                                : () => addKey(provider)
                          }
                        />
                      )}
                      <DropdownMenu
                        button={{
                          label: `${name} connection options`,
                          isIconOnly: true,
                          icon: <MoreHorizontal size={17} />,
                          variant: "ghost",
                          size: "sm",
                          isDisabled: busy,
                        }}
                        hasChevron={false}
                        alignment="end"
                        items={options}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <details className="preferences-note">
              <summary>
                <ChevronDown size={13} />
                How credentials are stored
              </summary>
              <p>
                API keys use macOS Keychain. Existing logins are copied into
                private local storage for the official agent. Claude Code
                refreshes its own container login. Refresh an imported login
                here if it expires; disconnecting removes only Nerilo’s copy.
              </p>
            </details>
          </>
        ) : section === "mcp" ? (
          <McpSettings
            servers={data.settings.mcpServers}
            busy={busy}
            save={(servers) => act("mcp-servers", { servers })}
          />
        ) : section === "skills" ? (
          <SkillsSettings
            skills={data.settings.skills}
            busy={busy}
            save={(skills) => act("skills", { skills })}
          />
        ) : section === "environment" ? (
          <>
            <header className="preferences-heading">
              <h2>Environment</h2>
              <p>How tasks run on this device.</p>
            </header>
            <div className="preferences-rows">
              <div className="preferences-row">
                <div className="preferences-row-copy">
                  <h3>Docker</h3>
                  <p>
                    {data.runtime.docker
                      ? "Container runtime"
                      : "Open Docker Desktop to run tasks"}
                  </p>
                </div>
                <span
                  className={`preferences-status ${data.runtime.docker ? "" : "is-unavailable"}`}
                >
                  <span />
                  {data.runtime.docker ? "Running" : "Stopped"}
                </span>
              </div>
              <div className="preferences-row">
                <div className="preferences-row-copy">
                  <h3>Agent environment</h3>
                  <p>Codex, Claude Code, Bun, Node, Python, and Git</p>
                </div>
                <Button
                  size="sm"
                  label={
                    data.runtime.building
                      ? "Building…"
                      : data.runtime.image
                        ? "Rebuild"
                        : "Prepare"
                  }
                  isLoading={data.runtime.building}
                  isDisabled={!data.runtime.docker || busy}
                  onClick={() => {
                    void act("runtime/build");
                  }}
                />
              </div>
              <div className="preferences-row">
                <div className="preferences-row-copy">
                  <h3>Concurrent tasks</h3>
                  <p>Maximum tasks running at once</p>
                </div>
                <Selector
                  label="Concurrent tasks"
                  isLabelHidden
                  value={String(data.settings.concurrency)}
                  options={["1", "2", "3", "4"]}
                  width={84}
                  isDisabled={busy}
                  onChange={(value) =>
                    changeSettings({ concurrency: Number(value) })
                  }
                />
              </div>
              <div className="preferences-row">
                <div className="preferences-row-copy">
                  <h3>
                    <Shield size={14} />
                    Default sandbox
                  </h3>
                  <p>
                    {data.settings.sandbox.cpus}{" "}
                    {data.settings.sandbox.cpus === 1 ? "core" : "cores"} ·{" "}
                    {data.settings.sandbox.memoryMB / 1024} GB memory ·{" "}
                    {data.settings.sandbox.network === "internet"
                      ? "Internet"
                      : "AI provider only"}
                  </p>
                </div>
                <SandboxControls
                  triggerLabel="Configure"
                  defaults={data.settings.sandbox}
                  onSaved={refresh}
                />
              </div>
            </div>
            {data.runtime.buildLog && (
              <details className="preferences-note">
                <summary>
                  <ChevronDown size={13} />
                  Environment build output
                </summary>
                <pre
                  className="build-output"
                  tabIndex={0}
                  aria-label="Environment build output"
                >
                  {data.runtime.buildLog}
                </pre>
              </details>
            )}
            <p className="preferences-footnote">
              Tasks keep running when you close the browser. A sleeping computer
              pauses progress.
            </p>
          </>
        ) : section === "keyboard" ? (
          <KeyboardSettings
            bindings={data.settings.keybindings}
            busy={busy}
            save={(keybindings) =>
              act("settings", { ...data.settings, keybindings })
            }
          />
        ) : (
          <>
            <header className="preferences-heading">
              <h2>Appearance</h2>
              <p>Make the workspace feel like yours.</p>
            </header>
            <fieldset className="preferences-themes">
              <legend>Theme</legend>
              {(
                [
                  { value: "light", label: "Warm light" },
                  { value: "dark", label: "Warm dark" },
                  { value: "system", label: "System" },
                ] as const
              ).map(({ value, label }) => (
                <label className="preferences-theme" key={value}>
                  <input
                    type="radio"
                    name="nerilo-appearance"
                    value={value}
                    checked={data.settings.appearance === value}
                    disabled={busy}
                    onChange={() => changeSettings({ appearance: value })}
                  />
                  <span
                    className={`preferences-theme-preview theme-${value}`}
                    aria-hidden="true"
                  >
                    <span className="theme-preview-sidebar">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="theme-preview-body">
                      <i />
                      <i />
                      <i />
                    </span>
                    {value === "system" && <Monitor size={18} />}
                  </span>
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
          </>
        )}
      </section>
    </div>
  );
}
