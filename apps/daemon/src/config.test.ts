import { expect, test } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command } from "./config";

test("command deadlines stop processes that ignore SIGTERM", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { command } from ${JSON.stringify(join(import.meta.dirname, "config.ts"))}; const result = await command([process.execPath, "-e", "process.on('SIGTERM', () => {}); setTimeout(() => process.exit(0), 500)"], { timeout: 100 }); console.log(result.code);`,
    ],
    {
      env: process.env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const timer = setTimeout(() => child.kill("SIGKILL"), 2000);
  try {
    expect((await new Response(child.stdout).text()).trim()).toBe("124");
    expect(await child.exited).toBe(0);
  } finally {
    clearTimeout(timer);
    child.kill("SIGKILL");
  }
});

test("command output decodes multibyte text across stream chunks", async () => {
  const result = await command([
    process.execPath,
    "-e",
    "process.stdout.write(Buffer.from([0xc3])); setTimeout(() => process.stdout.write(Buffer.from([0xa9])), 10)",
  ]);
  expect(result.stdout).toBe("é");
});

test("command can drain logs while retaining only their tail", async () => {
  const result = await command(
    [
      process.execPath,
      "-e",
      "process.stdout.write('x'.repeat(100000) + 'finished'); process.stderr.write('y'.repeat(100000) + 'warning');",
    ],
    { outputTail: 8 },
  );
  expect(result.stdout).toBe("finished");
  expect(result.stderr).toBe("ywarning");
  expect(result.code).toBe(0);
});

async function initialize(directory: string) {
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `import { token } from ${JSON.stringify(join(import.meta.dirname, "config.ts"))}; process.stdout.write(token);`,
    ],
    {
      env: { ...process.env, NERILO_DATA_DIR: directory },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [code, output, error] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, output, error };
}

test("daemon startup rejects an empty credential and never follows a token symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-token-"));
  try {
    const path = join(directory, "daemon-token");
    await writeFile(path, "\n");
    expect((await initialize(directory)).code).not.toBe(0);
    await rm(path);
    const target = join(directory, "unrelated");
    await writeFile(target, "a".repeat(72), { mode: 0o644 });
    await symlink(target, path);
    expect((await initialize(directory)).code).not.toBe(0);
    expect((await stat(target)).mode & 0o777).toBe(0o644);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("concurrent startup shares one complete private credential", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-token-"));
  try {
    const results = await Promise.all(
      Array.from({ length: 12 }, () => initialize(directory)),
    );
    const saved = (
      await readFile(join(directory, "daemon-token"), "utf8")
    ).trim();
    expect(saved.length).toBeGreaterThanOrEqual(32);
    for (const result of results) {
      expect(result.code).toBe(0);
      expect(result.output).toBe(saved);
    }
    expect((await stat(join(directory, "daemon-token"))).mode & 0o777).toBe(
      0o600,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
