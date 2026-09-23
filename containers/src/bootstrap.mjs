import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { pendingSetup, setupPendingPath, workspacePrepared } from "./git.mjs";

const lines = createInterface({ input: process.stdin });
const config = await new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Workspace preparation input timed out.")),
    30000,
  );
  lines.once("line", (line) => {
    clearTimeout(timeout);
    try {
      resolve(JSON.parse(line));
    } catch (error) {
      reject(error);
    }
    lines.close();
  });
});
function run(args, cwd = "/work/repo") {
  const result = spawnSync(args[0], args.slice(1), {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10_000_000,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0)
    throw new Error(`${args[0]} failed during preparation.`);
}
if (!workspacePrepared()) {
  rmSync("/work/repo", { recursive: true, force: true });
  run(["git", "clone", "/work/source.bundle", "/work/repo"], "/work");
  run(["git", "checkout", "-B", config.branch]);
  run(["git", "config", "user.name", "Nerilo"]);
  run(["git", "config", "user.email", "agent@nerilo.local"]);
  if (existsSync("/work/changes.patch"))
    run(["git", "apply", "--binary", "/work/changes.patch"]);
  if (config.setup || config.retrySetup) writeFileSync(setupPendingPath(), "");
  // Removing the bundle marks preparation complete; it must come last.
  rmSync("/work/source.bundle", { force: true });
  rmSync("/work/changes.patch", { force: true });
}
const setup = pendingSetup(config);
if (setup) {
  run(["sh", "-lc", setup]);
  rmSync(setupPendingPath(), { force: true });
}
