import { captureWorkspace } from "./git.mjs";
import { run } from "./process.mjs";

const [command, base] = process.argv.slice(2);
try {
  const check = await run(["sh", "-lc", command], { timeout: 300000 });
  const verification = {
    command,
    exitCode: check.code,
    output: `${check.out}${check.err}`.slice(-50000),
  };
  process.stdout.write(
    JSON.stringify({ verification, ...(await captureWorkspace(base)) }) + "\n",
  );
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
