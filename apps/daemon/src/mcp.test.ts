import { expect, test } from "bun:test";
import {
  mcpServersSchema,
  settingsSchema,
  sandboxDefaults,
  type McpServer,
} from "@nerilo/protocol";
import { Store } from "./store";
import { saveMcpServers, taskMcpServers } from "./mcp";
import { createApi } from "./api";
import { Engine } from "./engine";

const stdio = {
  id: "local",
  name: "Local tools",
  enabled: true,
  transport: "stdio",
  command: "node",
  args: ["server.mjs", "a quoted argument"],
  env: { SERVICE_TOKEN: "secret-local-fixture" },
} satisfies McpServer;
const http = {
  id: "remote",
  name: "Remote tools",
  enabled: true,
  transport: "http",
  url: "https://example.com/mcp",
  headers: { Authorization: "Bearer secret-http-fixture" },
} satisfies McpServer;

test("MCP validation rejects invalid transport, credentials in URLs, header injection and duplicate identities", () => {
  for (const url of [
    "not a url",
    "file:///tmp/server",
    "https://name:password@example.com/mcp",
    "https://example.com/mcp#fragment",
  ]) {
    expect(mcpServersSchema.safeParse([{ ...http, url }]).success).toBe(false);
  }
  expect(
    mcpServersSchema.safeParse([
      { ...http, headers: { Authorization: "token\r\nOther: injected" } },
    ]).success,
  ).toBe(false);
  expect(
    mcpServersSchema.safeParse([{ ...stdio, env: { "INVALID=KEY": "value" } }])
      .success,
  ).toBe(false);
  expect(
    mcpServersSchema.safeParse([{ ...stdio, command: "node\nother" }]).success,
  ).toBe(false);
  expect(
    mcpServersSchema.safeParse([stdio, { ...stdio, name: "Other" }]).success,
  ).toBe(false);
  expect(
    mcpServersSchema.safeParse([
      stdio,
      { ...stdio, id: "other", name: "LOCAL TOOLS" },
    ]).success,
  ).toBe(false);
  expect(mcpServersSchema.parse([stdio, http])).toHaveLength(2);
});

test("legacy settings default to no MCP; enabled selection respects sandbox networking and captures the turn config", () => {
  expect(settingsSchema.parse({}).mcpServers).toEqual([]);
  const settings = settingsSchema.parse({
    mcpServers: [stdio, { ...http, enabled: false }],
  });
  const selected = taskMcpServers(settings, {
    ...sandboxDefaults,
    network: "provider-only",
  });
  expect(selected.map((server) => server.id)).toEqual(["local"]);
  const updated = settingsSchema.parse({ ...settings, mcpServers: [http] });
  expect(() =>
    taskMcpServers(updated, { ...sandboxDefaults, network: "provider-only" }),
  ).toThrow("HTTP MCP servers need Internet access");
  expect(taskMcpServers(updated, sandboxDefaults)).toHaveLength(1);
  expect(selected[0]).toEqual(stdio);
});

test("MCP API persists server changes, preserves unrelated settings, and leaves invalid changes unapplied", async () => {
  const store = new Store(":memory:");
  const api = createApi(store, new Engine(store, true), "test");
  const post = (path: string, body: unknown) =>
    api(
      new Request(`http://localhost/${path}`, {
        method: "POST",
        headers: {
          Authorization: "Bearer test",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      }),
    );
  try {
    const previous = store.get("settings", "default")!;
    expect((await post("mcp-servers", { servers: [stdio, http] })).status).toBe(
      200,
    );
    expect(store.get("settings", "default")?.mcpServers).toEqual([stdio, http]);
    expect(store.get("settings", "default")?.sandbox).toEqual(previous.sandbox);
    expect(
      JSON.stringify(store.db.query("SELECT text FROM events").all()),
    ).not.toContain("secret-");
    expect(
      (await post("mcp-servers", { servers: [{ ...http, url: "bad" }] }))
        .status,
    ).toBeGreaterThanOrEqual(400);
    expect(store.get("settings", "default")?.mcpServers).toHaveLength(2);
    await post("settings", { appearance: "dark", mcpServers: [] });
    expect(store.get("settings", "default")?.mcpServers).toHaveLength(2);
    const saved = saveMcpServers(store, [{ ...stdio, enabled: false }]);
    expect(saved[0].enabled).toBe(false);
    saveMcpServers(store, []);
    expect(store.get("settings", "default")?.mcpServers).toEqual([]);
  } finally {
    store.db.close();
  }
});

test("restricted HTTP MCP startup keeps the queued request for retry before creating a sandbox", async () => {
  const { spyOn } = await import("bun:test");
  const { projectSchema, taskSchema } = await import("@nerilo/protocol");
  const store = new Store(":memory:");
  const engine = new Engine(store, true);
  const project = projectSchema.parse({
    id: crypto.randomUUID(),
    name: "MCP fixture",
    path: "/unused",
    branch: "main",
    createdAt: "now",
  });
  store.put("project", project.id, project);
  const task = taskSchema.parse({
    id: crypto.randomUUID(),
    projectId: project.id,
    title: "MCP access",
    provider: "codex",
    presetId: "programmer",
    model: "",
    status: "queued",
    sessionId: null,
    baseCommit: null,
    includeChanges: false,
    pending: [
      { id: crypto.randomUUID(), text: "Use the server", createdAt: "now" },
    ],
    activeTurnId: null,
    createdAt: "now",
    updatedAt: "now",
    archived: false,
    error: null,
    stopRequested: false,
    sandbox: { ...sandboxDefaults, network: "provider-only" },
  });
  store.put("task", task.id, task);
  saveMcpServers(store, [http]);
  const runtime = spyOn(engine, "runtime").mockResolvedValue({
    docker: true,
    image: true,
    building: false,
    buildLog: "",
    connections: {
      codex: {
        ready: true,
        source: "fixture",
        canImport: false,
        canImportGateway: false,
        mode: "direct",
      },
      claude: {
        ready: false,
        source: "none",
        canImport: false,
        canImportGateway: false,
        mode: "direct",
      },
    },
  });
  try {
    await engine.tick();
    await Bun.sleep(10);
    expect(store.get("task", task.id)?.status).toBe("failed");
    expect(store.get("task", task.id)?.error).toContain(
      "HTTP MCP servers need Internet access",
    );
    expect(store.get("task", task.id)?.pending).toEqual(task.pending);
    expect(store.all("turn")).toHaveLength(0);
  } finally {
    runtime.mockRestore();
    store.db.close();
  }
});
