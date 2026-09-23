"use client";
import { useRef, useState } from "react";
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Switch } from "@astryxdesign/core/Switch";
import { mcpServersSchema, type McpServer } from "@nerilo/protocol";
import { Modal } from "@/components/editors/editors";
import { Button, Selector, TextArea, TextInput } from "@/components/ui/ui";
import "@/features/settings/mcp-settings.css";

function parseValues(value: string, label: string): Record<string, string> {
  if (!value.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(
      `${label} must be a JSON object, with quoted names and values.`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((item) => typeof item !== "string")
  ) {
    throw new Error(`${label} must be a JSON object containing text values.`);
  }
  return parsed as Record<string, string>;
}

export function McpSettings({
  servers,
  busy,
  save,
}: {
  servers: McpServer[];
  busy: boolean;
  save: (servers: McpServer[]) => Promise<boolean>;
}) {
  const [editor, setEditor] = useState<{ server?: McpServer } | null>(null);
  const [removing, setRemoving] = useState<McpServer | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const serverButtons = useRef(new Map<string, HTMLButtonElement>());
  const locked = busy || saving;
  function restoreFocus(id?: string) {
    requestAnimationFrame(() =>
      (id
        ? (serverButtons.current.get(id) ?? addButton.current)
        : addButton.current
      )?.focus(),
    );
  }
  async function update(next: McpServer[]) {
    if (busy || inFlight.current) return false;
    inFlight.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const success = await save(next);
      if (success) setNotice("Saved.");
      else setError("Could not save MCP servers. Please try again.");
      return success;
    } catch {
      setError("Could not save MCP servers. Please try again.");
      return false;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  return (
    <>
      <header className="preferences-heading mcp-settings-heading">
        <div>
          <h2>MCP servers</h2>
          <p>Connect tools and data to Codex and Claude Code.</p>
        </div>
        <Button
          ref={addButton}
          label="Add server"
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
        {servers.length ? (
          servers.map((server) => (
            <div className="preferences-row mcp-settings-row" key={server.id}>
              <div className="preferences-row-copy">
                <h3>{server.name}</h3>
                <p>
                  {server.transport === "stdio"
                    ? "Sandbox command"
                    : "HTTP server"}
                </p>
              </div>
              <div className="preferences-row-actions">
                <Switch
                  label={`Enable ${server.name}`}
                  isLabelHidden
                  size="sm"
                  value={server.enabled}
                  isDisabled={locked}
                  onChange={(enabled) =>
                    void update(
                      servers.map((item) =>
                        item.id === server.id ? { ...item, enabled } : item,
                      ),
                    )
                  }
                />
                <DropdownMenu
                  button={{
                    ref: (element) => {
                      if (element)
                        serverButtons.current.set(server.id, element);
                      else serverButtons.current.delete(server.id);
                    },
                    label: `${server.name} options`,
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
                      label: "Edit server…",
                      onClick: () => {
                        setError("");
                        setEditor({ server });
                      },
                    },
                    { type: "divider" },
                    {
                      label: "Remove server…",
                      onClick: () => {
                        setError("");
                        setRemoving(server);
                      },
                    },
                  ]}
                />
              </div>
            </div>
          ))
        ) : (
          <p className="mcp-settings-empty">No MCP servers yet.</p>
        )}
      </div>
      {servers.length > 0 && (
        <p className="preferences-footnote">
          Enabled by default. Override per task; changes apply next turn.
        </p>
      )}
      <details className="preferences-note">
        <summary>
          <ChevronDown size={13} />
          Connecting to a server
        </summary>
        <p>
          Commands run inside the sandbox, where their packages and files must
          be available. For an HTTP server on the daemon machine, use{" "}
          <code>host.docker.internal</code> instead of <code>localhost</code>.
          HTTP servers require a sandbox with internet access.
        </p>
      </details>
      {error && !editor && !removing && (
        <p role="alert" className="error-note">
          {error}
        </p>
      )}
      <span className="mcp-settings-notice" role="status">
        {notice}
      </span>
      {editor && (
        <McpServerDialog
          server={editor.server}
          servers={servers}
          busy={locked}
          error={error}
          save={update}
          onClose={() => {
            if (!inFlight.current) {
              setEditor(null);
              restoreFocus(editor.server?.id);
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
                label="Remove server"
                isDisabled={locked}
                isLoading={saving}
                onClick={() => {
                  void update(
                    servers.filter((server) => server.id !== removing.id),
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
            Removes this configuration from Nerilo. Running turns keep their
            current tools.
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

function McpServerDialog({
  server,
  servers,
  busy,
  error,
  save,
  onClose,
}: {
  server?: McpServer;
  servers: McpServer[];
  busy: boolean;
  error: string;
  save: (servers: McpServer[]) => Promise<boolean>;
  onClose: () => void;
}) {
  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<"stdio" | "http">(
    server?.transport ?? "stdio",
  );
  const [command, setCommand] = useState(
    server?.transport === "stdio" ? server.command : "",
  );
  const [args, setArgs] = useState(
    server?.transport === "stdio" ? server.args.join("\n") : "",
  );
  const [env, setEnv] = useState(
    server?.transport === "stdio" && Object.keys(server.env).length
      ? JSON.stringify(server.env, null, 2)
      : "",
  );
  const [url, setUrl] = useState(
    server?.transport === "http" ? server.url : "",
  );
  const [headers, setHeaders] = useState(
    server?.transport === "http" && Object.keys(server.headers).length
      ? JSON.stringify(server.headers, null, 2)
      : "",
  );
  const [issue, setIssue] = useState("");
  const [id] = useState(() => server?.id ?? crypto.randomUUID());
  async function submit() {
    if (busy) return;
    setIssue("");
    if (!name.trim()) {
      setIssue("Enter a name for this server.");
      return;
    }
    if (transport === "stdio" && !command.trim()) {
      setIssue("Enter the command that starts this server.");
      return;
    }
    if (transport === "http" && !url.trim()) {
      setIssue("Enter the server’s HTTP or HTTPS URL.");
      return;
    }
    try {
      const base = { id, name: name.trim(), enabled: server?.enabled ?? true };
      const next: McpServer =
        transport === "stdio"
          ? {
              ...base,
              transport,
              command: command.trim(),
              args:
                server?.transport === "stdio" && args === server.args.join("\n")
                  ? server.args
                  : args.replace(/\r\n/g, "\n").split("\n").filter(Boolean),
              env: parseValues(env, "Environment variables"),
            }
          : {
              ...base,
              transport,
              url: url.trim(),
              headers: parseValues(headers, "Headers"),
            };
      const updated = server
        ? servers.map((item) => (item.id === id ? next : item))
        : [...servers, next];
      const parsed = mcpServersSchema.safeParse(updated);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        const field = String(first?.path[1] ?? "");
        const labels: Record<string, string> = {
          name: "Name",
          command: "Command",
          args: "Arguments",
          env: "Environment variables",
          url: "Server URL",
          headers: "Headers",
        };
        setIssue(
          first
            ? `${labels[field] ? `${labels[field]}: ` : ""}${first.message}`
            : "Check the server configuration.",
        );
        return;
      }
      if (await save(parsed.data)) onClose();
    } catch (reason) {
      setIssue(
        reason instanceof Error
          ? reason.message
          : "Check the server configuration.",
      );
    }
  }
  return (
    <Modal
      title={server ? "Edit MCP server" : "Add MCP server"}
      width={480}
      onClose={onClose}
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
            label={server ? "Save changes" : "Add server"}
            isDisabled={busy}
            isLoading={busy}
            onClick={() => void submit()}
          />
        </>
      }
    >
      <TextInput
        label="Name"
        value={name}
        onChange={setName}
        placeholder="My tools"
        hasAutoFocus
        isDisabled={busy}
      />
      <Selector
        label="Connection"
        value={transport}
        onChange={(value) => setTransport(value === "http" ? "http" : "stdio")}
        isDisabled={busy}
        options={[
          { value: "stdio", label: "Command (stdio)" },
          { value: "http", label: "HTTP" },
        ]}
      />
      {transport === "stdio" ? (
        <>
          <TextInput
            label="Command"
            value={command}
            onChange={setCommand}
            placeholder="npx"
            description="Runs inside the sandbox."
            isDisabled={busy}
          />
          <TextArea
            label="Arguments"
            value={args}
            onChange={setArgs}
            rows={3}
            placeholder={
              "-y\n@modelcontextprotocol/server-filesystem\n/work/repo"
            }
            description="One argument per line, without shell quotes."
            isOptional
            isDisabled={busy}
          />
          <details className="mcp-settings-values">
            <summary>
              <ChevronDown size={13} />
              Environment variables{env.trim() ? " · configured" : ""}
            </summary>
            <div className="form-stack">
              <TextArea
                label="Environment variables (JSON)"
                value={env}
                onChange={setEnv}
                rows={4}
                placeholder={'{ "API_KEY": "your-key" }'}
                isDisabled={busy}
              />
            </div>
          </details>
        </>
      ) : (
        <>
          <TextInput
            label="Server URL"
            value={url}
            onChange={setUrl}
            placeholder="https://example.com/mcp"
            description="Requires internet access in the sandbox. Use host.docker.internal for a server on the daemon machine."
            isDisabled={busy}
          />
          <details className="mcp-settings-values">
            <summary>
              <ChevronDown size={13} />
              Headers{headers.trim() ? " · configured" : ""}
            </summary>
            <div className="form-stack">
              <TextArea
                label="Headers (JSON)"
                value={headers}
                onChange={setHeaders}
                rows={4}
                placeholder={'{ "Authorization": "Bearer your-token" }'}
                isDisabled={busy}
              />
            </div>
          </details>
        </>
      )}
      {(issue || error) && (
        <p role="alert" className="error-note">
          {issue || error}
        </p>
      )}
    </Modal>
  );
}
