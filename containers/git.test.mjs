import { test, expect } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureWorkspace } from "./git.mjs";
import { run } from "./process.mjs";

test("result capture preserves unusual filenames, staging, and an applicable binary patch", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nerilo-capture-"));
  const git = async (...args) => {
    const result = await run(["git", ...args], { cwd });
    if (result.code) throw new Error(result.err);
    return result.out;
  };
  try {
    await git("init", "-b", "main");
    await Bun.write(join(cwd, "original"), "before\n");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Initial",
    );
    const base = (await git("rev-parse", "HEAD")).trim();
    await Bun.write(join(cwd, "original"), "staged\n");
    await git("add", "original");
    const index = await readFile(join(cwd, ".git/index"));
    await Bun.write(join(cwd, "original"), "after\n");
    const paths = ["café.txt", "tab\tname.txt", "line\nname.txt", " trailing "];
    for (const path of paths) await Bun.write(join(cwd, path), "content\n");
    await Bun.write(join(cwd, "binary"), new Uint8Array([0, 1, 2, 3]));
    const captured = await captureWorkspace(base, cwd);
    expect(captured.changes.map((change) => change.path).sort()).toEqual(
      [...paths, "binary", "original"].sort(),
    );
    expect(captured.truncated).toBe(false);
    expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
    await git("reset", "--hard", base);
    for (const path of [...paths, "binary"]) await rm(join(cwd, path));
    const applied = await run(["git", "apply", "--binary", "-"], {
      cwd,
      input: captured.diff,
    });
    expect(applied.code).toBe(0);
    expect(await readFile(join(cwd, "original"), "utf8")).toBe("after\n");
    for (const path of paths)
      expect(await readFile(join(cwd, path), "utf8")).toBe("content\n");
    expect(await readFile(join(cwd, "binary"))).toEqual(
      Buffer.from([0, 1, 2, 3]),
    );
    await expect(captureWorkspace("missing-revision", cwd)).rejects.toThrow(
      "Could not capture",
    );
    await Bun.write(join(cwd, "large"), "long source line\n".repeat(40000));
    const large = await captureWorkspace(base, cwd);
    expect(large.truncated).toBe(true);
    expect(large.diff.startsWith("diff --git ")).toBe(true);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("subprocess output retains split UTF-8 and reports timeouts even when SIGTERM is ignored", async () => {
  const utf8 = await run(
    [
      process.execPath,
      "-e",
      "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 10)",
    ],
    { cwd: tmpdir() },
  );
  expect(utf8.out).toBe("é");
  const stalled = await run(
    [
      process.execPath,
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    ],
    { cwd: tmpdir(), timeout: 100 },
  );
  expect(stalled.code).toBe(124);
});
