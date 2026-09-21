import { expect, test } from "bun:test";
import { parseHarnessKeys } from "./harness-credentials";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("harness imports accept supported literal API keys without importing OAuth or executing helpers", () => {
  for (const provider of ["opencode", "pi"] as const) {
    const type = provider === "opencode" ? "api" : "api_key";
    expect(
      parseHarnessKeys(provider, {
        anthropic: { type, key: "fixture-anthropic-key" },
        openai: { type: "oauth", access: "fixture-access-token" },
        google: { type, key: "!printf fixture-key" },
        unknown: { type, key: "fixture-unsupported-key" },
      }),
    ).toEqual({ anthropic: "fixture-anthropic-key" });
    for (const invalid of [null, [], {}, { anthropic: { type, key: " " } }])
      expect(parseHarnessKeys(provider, invalid)).toEqual({});
  }
  expect(
    parseHarnessKeys("pi", {
      anthropic: { type: "api_key", key: "${MY_API_KEY}" },
    }),
  ).toEqual({});
});

test("harness connections import privately, generate vendor models and respect disconnect", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-harness-auth-"));
  try {
    await mkdir(join(directory, "opencode"));
    await writeFile(
      join(directory, "opencode/auth.json"),
      JSON.stringify({ openai: { type: "api", key: "fixture-openai-key" } }),
    );
    await mkdir(join(directory, "pi"));
    await writeFile(
      join(directory, "pi/auth.json"),
      JSON.stringify({
        openai: { type: "api_key", key: "fixture-openai-key" },
        anthropic: { type: "api_key", key: "fixture-anthropic-key" },
      }),
    );
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `
      import { importHarness, connection, credentials, disconnect } from ${JSON.stringify(join(import.meta.dirname, "credentials.ts"))};
      import { modelCatalog, validateExecution } from ${JSON.stringify(join(import.meta.dirname, "models.ts"))};
      Object.defineProperty(process, "platform", { value: "linux" });
      const output = [];
      for (const provider of ["opencode", "pi"]) {
        importHarness(provider);
        output.push((await connection(provider)).ready);
        output.push(Object.keys((await credentials(provider)).harnessKeys));
        output.push((await modelCatalog())[provider].map(model => model.id));
        output.push((await modelCatalog()).defaults[provider]);
        await validateExecution({ provider, model: provider === "pi" ? "anthropic/claude-sonnet-4-6" : "openai/gpt-5.4", effort: "high" });
        await disconnect(provider);
        output.push((await connection(provider)).ready);
        output.push((await modelCatalog()).defaults[provider]);
      }
      console.log(JSON.stringify(output));
    `,
      ],
      {
        env: {
          ...process.env,
          XDG_DATA_HOME: directory,
          PI_CODING_AGENT_DIR: join(directory, "pi"),
          NERILO_DATA_DIR: join(directory, "private"),
          ANTHROPIC_API_KEY: "fixture-environment-key",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, output, error] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(error).toBe("");
    expect(code).toBe(0);
    expect(JSON.parse(output)).toEqual([
      true,
      ["openai"],
      ["openai/gpt-5.4"],
      { model: "openai/gpt-5.4", source: "nerilo" },
      false,
      { model: "", source: "nerilo" },
      true,
      ["anthropic", "openai"],
      ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4"],
      { model: "anthropic/claude-sonnet-4-6", source: "nerilo" },
      false,
      { model: "", source: "nerilo" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
