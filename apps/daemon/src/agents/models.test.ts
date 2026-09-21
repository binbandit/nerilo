import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelCatalog, validateExecution } from "./models";

test("Codex choices work before a first turn and survive missing or invalid caches", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-models-"));
  const source = join(directory, "codex");
  const destination = join(directory, "data");
  await mkdir(source);
  await mkdir(destination);
  const catalog = async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { modelCatalog } from ${JSON.stringify(join(import.meta.dirname, "models.ts"))}; console.log(JSON.stringify((await modelCatalog()).codex));`,
      ],
      {
        env: {
          ...process.env,
          CODEX_HOME: source,
          NERILO_DATA_DIR: destination,
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
    return JSON.parse(output);
  };
  try {
    const fallback = await catalog();
    expect(fallback.length).toBeGreaterThan(1);
    expect(
      fallback.find((model: { id: string }) => model.id === "gpt-6-astra")
        .efforts,
    ).toContain("ultra");
    const advertised = {
      slug: "fixture-codex",
      display_name: "Fixture Codex",
      visibility: "list",
      supported_reasoning_levels: [
        { effort: "high" },
        { effort: "ultra" },
        { effort: "future-effort" },
      ],
      default_reasoning_level: "high",
    };
    await writeFile(
      join(source, "models_cache.json"),
      JSON.stringify({
        models: [
          advertised,
          { ...advertised, slug: "hidden", visibility: "hide" },
          { slug: "malformed" },
        ],
      }),
    );
    const local = [
      {
        id: "fixture-codex",
        name: "Fixture Codex",
        efforts: ["high", "ultra"],
        defaultEffort: "high",
      },
    ];
    expect(await catalog()).toEqual(local);
    await writeFile(join(destination, "codex-models.json"), "[]");
    expect(await catalog()).toEqual(local);
    const saved = [{ ...local[0], id: "container-codex" }];
    await writeFile(
      join(destination, "codex-models.json"),
      JSON.stringify(saved),
    );
    expect(await catalog()).toEqual(saved);
    await writeFile(join(source, "models_cache.json"), "{");
    expect(await catalog()).toEqual(saved);
    await writeFile(join(destination, "codex-models.json"), "{");
    expect(await catalog()).toEqual(fallback);
    await writeFile(
      join(source, "models_cache.json"),
      JSON.stringify({ models: [] }),
    );
    expect(await catalog()).toEqual(fallback);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

describe("Claude model selection", () => {
  test("Fable models expose the full supported effort range", async () => {
    const catalog = await modelCatalog();
    for (const id of ["claude-fable-5-1", "claude-fable-5"]) {
      const model = catalog.claude.find((entry) => entry.id === id);
      expect(model?.defaultEffort).toBe("high");
      expect(model?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
      for (const effort of ["xhigh", "max"] as const)
        await expect(
          validateExecution({ provider: "claude", model: id, effort }),
        ).resolves.toBeUndefined();
    }
  });

  test("rejects unsupported effort without rejecting custom Claude models", async () => {
    await expect(
      validateExecution({ provider: "claude", model: "haiku", effort: "high" }),
    ).rejects.toThrow("not supported");
    await expect(
      validateExecution({
        provider: "claude",
        model: "fable",
        effort: "ultra",
      }),
    ).rejects.toThrow("not supported");
    await expect(
      validateExecution({ provider: "claude", model: "fable", effort: "max" }),
    ).resolves.toBeUndefined();
  });
});
