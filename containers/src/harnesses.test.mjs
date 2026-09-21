import { expect, test } from "bun:test";
import { harnessArguments, harnessConnection } from "./harnesses.mjs";
import {
  agentRedactions,
  redactOutput,
  prepareMcpConfig,
  clearMcpConfig,
  MCP_OPENCODE_PATH,
} from "./mcp.mjs";
import { allowedTarget } from "./egress.mjs";
import { readFile } from "node:fs/promises";
import { defaultHarnessModels } from "../../packages/protocol/src/providers.ts";

test("automatic runner models match the catalog fallback models and provider priority", () => {
  for (const [vendor, model] of Object.entries(defaultHarnessModels)) {
    expect(
      harnessConnection({
        provider: "pi",
        model: "",
        harnessKeys: { [vendor]: "fixture-key" },
      }).model,
    ).toBe(`${vendor}/${model}`);
  }
  expect(
    harnessConnection({
      provider: "opencode",
      model: "",
      harnessKeys: { openai: "fixture-openai", anthropic: "fixture-anthropic" },
    }).model,
  ).toBe(`anthropic/${defaultHarnessModels.anthropic}`);
});

for (const provider of ["opencode", "pi"]) {
  test(`${provider} selects the model's key, resumes explicitly and keeps secrets out of arguments`, () => {
    const config = {
      provider,
      model: "openai/gpt-5.4",
      sessionId: "saved-session",
      effort: "high",
      harnessKeys: {
        openai: "fixture-openai-secret",
        anthropic: "fixture-anthropic-secret",
      },
    };
    const connection = harnessConnection(config);
    expect(connection.env.OPENAI_API_KEY).toBe(config.harnessKeys.openai);
    expect(connection.env.ANTHROPIC_API_KEY).toBeUndefined();
    const args = harnessArguments(config, connection);
    expect(args).toContain("--session");
    expect(args).toContain("saved-session");
    expect(args).toContain(config.model);
    expect(args.join(" ")).not.toContain("fixture-");
    expect(
      redactOutput(JSON.stringify(config), agentRedactions(config)),
    ).not.toContain("fixture-");
    expect(() =>
      harnessConnection({ ...config, model: "google/gemini-2.5-pro" }),
    ).toThrow("Connect an API key");
    expect(
      harnessConnection({
        ...config,
        model: "",
        harnessKeys: { openai: "fixture-secret" },
      }).model,
    ).toBe("openai/gpt-5.4");
  });
  test(`${provider} provider-only network allows supported APIs and blocks downloads and unrelated hosts`, () => {
    for (const host of [
      "api.anthropic.com",
      "api.openai.com",
      "generativelanguage.googleapis.com",
      "openrouter.ai",
    ])
      expect(allowedTarget(`${host}:443`, provider)).toBe(host);
    for (const authority of [
      "registry.npmjs.org:443",
      "models.dev:443",
      "example.com:443",
      "api.openai.com:80",
      "api.openai.com.evil.test:443",
    ])
      expect(allowedTarget(authority, provider)).toBeNull();
  });
}
test("Pi disables discovery, enables only selected skills, and maps none to off", () => {
  const args = harnessArguments(
    { provider: "pi", effort: "none" },
    { model: "anthropic/claude-sonnet-4-6" },
    { args: ["--skill", "/tmp/selected"] },
  );
  expect(args).toContain("--no-extensions");
  expect(args).toContain("--no-skills");
  expect(args).toContain("/tmp/selected");
  expect(args).toContain("off");
});
test("OpenCode stages native MCP configuration and Pi rejects unsupported MCP selections", async () => {
  const servers = [
    {
      enabled: true,
      id: "local",
      transport: "stdio",
      command: "node",
      args: ["server.mjs"],
      env: { TOKEN: "fixture-secret" },
    },
    {
      enabled: true,
      id: "remote",
      transport: "http",
      url: "https://example.test/mcp",
      headers: { Authorization: "Bearer fixture-token" },
    },
  ];
  try {
    const config = await prepareMcpConfig("opencode", servers);
    expect(config.args).toEqual([]);
    expect(config.env.OPENCODE_CONFIG).toBe(MCP_OPENCODE_PATH);
    const staged = JSON.parse(await readFile(MCP_OPENCODE_PATH, "utf8"));
    expect(staged.mcp.local.command).toEqual(["node", "server.mjs"]);
    expect(staged.mcp.remote.oauth).toBe(false);
    await expect(prepareMcpConfig("pi", servers)).rejects.toThrow(
      "Pi does not support MCP",
    );
    expect(await prepareMcpConfig("pi", [])).toEqual({ args: [], env: {} });
    await expect(
      prepareMcpConfig("opencode", [
        { ...servers[0], args: ["{file:/etc/passwd}"] },
      ]),
    ).rejects.toThrow("interpolation");
  } finally {
    await clearMcpConfig();
  }
});
