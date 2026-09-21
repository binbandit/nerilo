import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createInterface } from "node:readline";

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
if (!existsSync("/work/repo/.git")) {
  run(["git", "clone", "/work/source.bundle", "/work/repo"], "/work");
  run(["git", "checkout", "-B", config.branch]);
  run(["git", "config", "user.name", "Nerilo"]);
  run(["git", "config", "user.email", "agent@nerilo.local"]);
  if (existsSync("/work/changes.patch"))
    run(["git", "apply", "--binary", "/work/changes.patch"]);
  rmSync("/work/source.bundle", { force: true });
  rmSync("/work/changes.patch", { force: true });
}
if (config.setup) run(["sh", "-lc", config.setup]);
