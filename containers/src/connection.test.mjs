import { expect, test } from "bun:test";
import { agentConnection } from "./connection.mjs";
import { agentRedactions, redactOutput } from "./mcp.mjs";

const gateway = {
  baseUrl: "https://gateway.example.test/v1",
  model: "@test/reasoner",
  key: "fixture-secret-key",
  authHeader: "authorization",
  headers: { "x-company-token": "Bearer fixture-header-token" },
  env: {},
};
test("Codex routes through Responses with secrets confined to the child environment", () => {
  const connection = agentConnection({ provider: "codex", gateway });
  expect(connection.args.join(" ")).not.toContain(gateway.key);
  expect(connection.args.join(" ")).not.toContain("fixture-header-token");
  const config = Bun.TOML.parse(
    connection.args.filter((_, index) => index % 2 === 1).join("\n"),
  );
  expect(config.model_provider).toBe("nerilo_gateway");
  expect(config.model_providers.nerilo_gateway).toMatchObject({
    base_url: gateway.baseUrl,
    wire_api: "responses",
  });
  expect(connection.env.NERILO_GATEWAY_HEADER_1).toBe(`Bearer ${gateway.key}`);
  expect(connection.model).toBe(gateway.model);
});
test("Claude preserves company model aliases and headers, and explicit per-task models win", () => {
  const connection = agentConnection({
    provider: "claude",
    model: "opusplan",
    gateway: {
      ...gateway,
      authHeader: "x-api-key",
      env: {
        ANTHROPIC_DEFAULT_OPUS_MODEL: "@test/opus",
        CLAUDE_CODE_SUBAGENT_MODEL: "@test/sonnet",
      },
    },
  });
  expect(connection.env).toMatchObject({
    ANTHROPIC_BASE_URL: gateway.baseUrl,
    ANTHROPIC_API_KEY: gateway.key,
    ANTHROPIC_DEFAULT_OPUS_MODEL: "@test/opus",
    CLAUDE_CODE_SUBAGENT_MODEL: "@test/sonnet",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  });
  expect(connection.model).toBe("opusplan");
  expect(connection.env.ANTHROPIC_CUSTOM_HEADERS).toBe(
    "x-company-token: Bearer fixture-header-token",
  );
  const text = JSON.stringify(
    redactOutput(
      { message: `${gateway.key} fixture-header-token` },
      agentRedactions({ gateway }),
    ),
  );
  expect(text).not.toContain("fixture-");
});
