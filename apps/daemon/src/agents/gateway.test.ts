import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gatewayInputSchema } from "@nerilo/protocol";

test("gateway settings reject credential URLs, insecure endpoints and header injection", () => {
  const base = {
    baseUrl: "https://gateway.example.test",
    model: "opus",
    credential: { type: "key", value: "fixture" },
  };
  for (const baseUrl of [
    "http://gateway.example.test",
    "https://user:password@gateway.example.test",
    "https://gateway.example.test/?token=secret",
    "https://127.0.0.1",
  ])
    expect(gatewayInputSchema.safeParse({ ...base, baseUrl }).success).toBe(
      false,
    );
  for (const headers of [
    { "x-test": "value\r\nAuthorization: secret" },
    { Host: "other.example.test" },
    { "x-test": "one", "X-Test": "two" },
  ])
    expect(gatewayInputSchema.safeParse({ ...base, headers }).success).toBe(
      false,
    );
  expect(
    gatewayInputSchema.safeParse({
      ...base,
      env: { NODE_OPTIONS: "--require=bad" },
    }).success,
  ).toBe(false);
});

test("gateway imports preserve routing and key helpers without executing unrelated agent settings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-gateway-test-"));
  const source = join(directory, "source");
  await mkdir(source);
  const marker = join(directory, "hook-was-run");
  await writeFile(
    join(source, "settings.json"),
    JSON.stringify({
      model: "opus",
      apiKeyHelper: "printf '%s' \"$NERILO_FIXTURE_KEY\"",
      env: {
        ANTHROPIC_BASE_URL: "https://gateway.example.test",
        ANTHROPIC_MODEL: "opusplan",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "@test/opus",
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: "",
        ANTHROPIC_CUSTOM_HEADERS: "x-portkey-provider: @test-provider",
        SHELL: "/unknown/fish",
      },
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: `touch ${marker}` }] },
        ],
      },
    }),
  );
  await writeFile(
    join(source, "config.toml"),
    'model="@test/codex"\nmodel_provider="company"\n[model_providers.company]\nbase_url="https://gateway.example.test/v1"\nwire_api="responses"\nenv_key="NERILO_FIXTURE_KEY"\nenv_http_headers={ "x-private-token"="NERILO_FIXTURE_HEADER" }\n',
  );
  const script = `
    import assert from 'node:assert/strict';
    import { existsSync, statSync } from 'node:fs';
    import { join } from 'node:path';
    import { importedGateway, saveGateway, gatewayCredentials, gatewayView } from ${JSON.stringify(join(import.meta.dirname, "gateway.ts"))};
    const input = importedGateway('claude');
    assert.equal(input.model, 'opusplan');
    assert.equal(input.authHeader, 'x-api-key');
    assert.equal(input.env.ANTHROPIC_DEFAULT_OPUS_MODEL, '@test/opus');
    assert.equal(input.env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES, '');
    assert.equal(input.env.SHELL, undefined);
    saveGateway('claude', input);
    assert.equal(existsSync(${JSON.stringify(marker)}), false);
    assert.equal(statSync(join(process.env.NERILO_DATA_DIR, 'claude-gateway.json')).mode & 511, 384);
    const view = JSON.stringify(gatewayView('claude'));
    assert(!view.includes('printf')); assert(!view.includes('@test-provider'));
    assert.equal((await gatewayCredentials('claude')).key, 'fixture-one');
    process.env.NERILO_FIXTURE_KEY = 'fixture-two';
    assert.equal((await gatewayCredentials('claude')).key, 'fixture-two');
    saveGateway('claude', { ...input, credential: { type: 'command' } });
    assert.equal((await gatewayCredentials('claude')).key, 'fixture-two');
    assert.throws(() => saveGateway('claude', { ...input, baseUrl: 'https://other.example.test', credential: { type: 'command' } }));
    assert.throws(() => saveGateway('claude', { ...input, headers: { Authorization: 'bad' }, authHeader: 'authorization' }));
    const codex = importedGateway('codex');
    saveGateway('codex', codex);
    assert.equal((await gatewayCredentials('codex')).headers['x-private-token'], 'fixture-header');
    assert(!JSON.stringify(gatewayView('codex')).includes('fixture-header'));
    assert.equal(existsSync(${JSON.stringify(marker)}), false);
  `;
  try {
    const child = Bun.spawn([process.execPath, "-e", script], {
      env: {
        ...process.env,
        SHELL: "/bin/sh",
        NERILO_DATA_DIR: join(directory, "private"),
        CODEX_HOME: source,
        CLAUDE_CONFIG_DIR: source,
        NERILO_FIXTURE_KEY: "fixture-one",
        NERILO_FIXTURE_HEADER: "fixture-header",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, error] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    expect(error).toBe("");
    expect(code).toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
