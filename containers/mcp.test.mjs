import { test, expect } from "bun:test";
import { mkdtemp, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mcpConfigs,
  mcpRedactions,
  redactionVariants,
  clearMcpConfig,
  redactOutput,
  agentRedactions,
} from "./mcp.mjs";

test("imported API-key logins redact credentials without corrupting structured metadata", () => {
  const config = {
    codexAuth: {
      OPENAI_API_KEY: 'key-with-"quotes"',
      tokens: { access_token: "oauth-secret" },
    },
  };
  const redactions = agentRedactions(config);
  const value = {
    title: 'key-with-"quotes"',
    summary: "oauth-secret",
    nested: ['key-with-"quotes"'],
  };
  expect(JSON.parse(JSON.stringify(redactOutput(value, redactions)))).toEqual({
    title: "[redacted]",
    summary: "[redacted]",
    nested: ["[redacted]"],
  });
});

test("native provider configs preserve literal server input without TOML injection", () => {
  const servers = [
    {
      id: "stdio-server",
      name: "Local tools",
      enabled: true,
      transport: "stdio",
      command: "node",
      args: [
        'line\n\" }\n[mcp_servers.injected]\ncommand=\"oops\"',
        "\\path\t\u007f",
      ],
      env: { TOKEN: 'secret${HOME}"\\value' },
    },
    {
      id: "http-server",
      name: "Remote tools",
      enabled: true,
      transport: "http",
      url: "http://host.docker.internal:9999/mcp?token=literal${HOME}",
      headers: { Authorization: "Bearer header-secret", "X-Value": '"quoted"' },
    },
    {
      id: "off",
      name: "Off",
      enabled: false,
      transport: "stdio",
      command: "false",
    },
  ];
  const config = mcpConfigs(servers);
  const parsed = Bun.TOML.parse(config.codex);
  expect(Object.keys(parsed.mcp_servers)).toEqual([
    "stdio-server",
    "http-server",
  ]);
  expect(parsed.mcp_servers["stdio-server"]).toEqual({
    command: "node",
    args: servers[0].args,
    env: servers[0].env,
    cwd: "/work/repo",
  });
  expect(parsed.mcp_servers["http-server"]).toEqual({
    url: servers[1].url,
    http_headers: servers[1].headers,
  });
  const expanded = JSON.parse(config.claude, (_key, value) =>
    typeof value === "string"
      ? value.replace(/\$\{([^}]+)\}/g, (_match, key) => config.claudeEnv[key])
      : value,
  );
  expect(expanded.mcpServers["stdio-server"]).toEqual({
    type: "stdio",
    command: "node",
    args: servers[0].args,
    env: servers[0].env,
  });
  expect(expanded.mcpServers["http-server"]).toEqual({
    type: "http",
    url: servers[1].url,
    headers: servers[1].headers,
  });
  expect(config.claude).not.toContain("header-secret");
});

test("empty and disabled configurations replace previous servers explicitly", () => {
  for (const servers of [undefined, [], [{ id: "old", enabled: false }]]) {
    const config = mcpConfigs(servers);
    expect(Bun.TOML.parse(config.codex)).toEqual({ mcp_servers: {} });
    expect(JSON.parse(config.claude)).toEqual({ mcpServers: {} });
    expect(config.claudeEnv).toEqual({});
  }
});

test("MCP secrets redact escaped output, bearer tokens and encoded URL values", () => {
  const values = mcpRedactions([
    {
      env: { TOKEN: 'a-secret"\\with-escapes' },
      headers: { Authorization: "Bearer private-token" },
      url: "https://example.com/mcp?key=secret%2Bvalue",
    },
  ]);
  const scrub = (text) =>
    redactionVariants(values).reduce(
      (output, secret) => output.split(secret).join("[redacted]"),
      text,
    );
  expect(
    scrub('a-secret"\\with-escapes private-token secret+value secret%2Bvalue'),
  ).toBe("[redacted] [redacted] [redacted] [redacted]");
  expect(
    JSON.parse(scrub(JSON.stringify({ token: 'a-secret"\\with-escapes' }))),
  ).toEqual({ token: "[redacted]" });
});

test("cleanup removes only generated config targets and is repeatable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-mcp-test-"));
  const config = join(directory, "config.toml");
  const retained = join(directory, "session.json");
  try {
    await writeFile(config, "secret", { mode: 0o600 });
    await writeFile(retained, "history");
    await clearMcpConfig([config]);
    await clearMcpConfig([config]);
    expect(await stat(config).catch(() => null)).toBeNull();
    expect((await stat(retained)).isFile()).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("short secret values cannot corrupt the event JSON structure", () => {
  const output = redactOutput(
    {
      count: 1,
      ok: true,
      text: 'true and 1 and "quotes"',
      nested: ["1", null],
    },
    redactionVariants(["1", "true", '"']),
  );
  expect(JSON.parse(JSON.stringify(output))).toEqual({
    count: 1,
    ok: true,
    text: "[redacted] and [redacted] and [redacted]quotes[redacted]",
    nested: ["[redacted]", null],
  });
  const secrets = redactionVariants(["red"]);
  expect(redactOutput(redactOutput("red", secrets), secrets)).toBe(
    "[redacted]",
  );
  expect(
    redactOutput(
      "https://example.com?key=a+b",
      mcpRedactions([{ url: "https://example.com?key=a+b" }]),
    ),
  ).toBe("[redacted]");
  expect(
    redactOutput(
      {
        phase: "working",
        sessionId: "session-1",
        baseCommit: "def1abc",
        headCommit: "abc1def",
        text: "working 1",
      },
      ["working", "1"],
      new Set(["phase", "sessionId", "baseCommit", "headCommit"]),
    ),
  ).toEqual({
    phase: "working",
    sessionId: "session-1",
    baseCommit: "def1abc",
    headCommit: "abc1def",
    text: "[redacted] [redacted]",
  });
});
