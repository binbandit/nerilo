import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("imported Codex login requires usable credentials and detects later corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-import-"));
  const source = join(directory, "source");
  const destination = join(directory, "private");
  await mkdir(source);
  const invoke = async (script: string) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "-e",
        `import { importCodex, connection, credentials } from ${JSON.stringify(join(import.meta.dirname, "credentials.ts"))}; ${script}`,
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
    const [code, output] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { code, output };
  };
  try {
    for (const invalid of [[], {}, { tokens: {} }, { OPENAI_API_KEY: " " }]) {
      await writeFile(join(source, "auth.json"), JSON.stringify(invalid));
      expect((await invoke("importCodex()")).code).not.toBe(0);
    }
    for (const valid of [
      { OPENAI_API_KEY: "fixture-imported-api-key" },
      {
        tokens: {
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
        },
        last_refresh: "fixture",
      },
    ]) {
      await writeFile(join(source, "auth.json"), JSON.stringify(valid));
      expect((await invoke("importCodex()")).code).toBe(0);
      expect(
        JSON.parse(
          await readFile(join(destination, "codex-auth.json"), "utf8"),
        ),
      ).toEqual(valid);
    }
    await writeFile(join(destination, "codex-auth.json"), "{");
    const status = await invoke(
      "console.log(JSON.stringify({ ready: (await connection('codex')).ready, auth: (await credentials('codex')).codexAuth }))",
    );
    expect(status.code).toBe(0);
    expect(JSON.parse(status.output)).toEqual({ ready: false, auth: null });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
