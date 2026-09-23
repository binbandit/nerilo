import { test, expect } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const present = (path) =>
  access(path).then(
    () => true,
    () => false,
  );
const until = async (condition) => {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for the runner.");
};

test("Codex credentials on the home volume do not survive a killed or stopped turn", async () => {
  const home = await mkdtemp(join(tmpdir(), "nerilo-runner-"));
  const auth = join(home, "auth.json");
  try {
    // Left behind by a turn that was SIGKILLed before its `finally` ran.
    await writeFile(auth, "{}");
    const runner = spawn("node", [join(import.meta.dir, "runner.mjs")], {
      env: { ...process.env, CODEX_HOME: home },
      stdio: ["pipe", "ignore", "ignore"],
    });
    const exited = new Promise((resolve) =>
      runner.on("exit", (code, signal) => resolve({ code, signal })),
    );
    await until(async () => !(await present(auth)));
    // Credentials written for this turn are removed when docker stop signals it.
    await writeFile(auth, "{}");
    runner.kill("SIGTERM");
    expect(await exited).toEqual({ code: 143, signal: null });
    expect(await present(auth)).toBe(false);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
