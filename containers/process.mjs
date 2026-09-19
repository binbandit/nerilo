import { spawn } from "node:child_process";

export function run(
  args,
  {
    cwd = "/work/repo",
    env = {},
    input,
    timeout = 30000,
    maxOutput = 500000,
  } = {},
) {
  return new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [],
      stderr = [];
    let outBytes = 0,
      errBytes = 0,
      timedOut = false;
    child.stdout.on("data", (chunk) => {
      if (outBytes < maxOutput)
        stdout.push(chunk.subarray(0, maxOutput - outBytes));
      outBytes += chunk.length;
    });
    child.stderr.on("data", (chunk) => {
      if (errBytes < maxOutput)
        stderr.push(chunk.subarray(0, maxOutput - errBytes));
      errBytes += chunk.length;
    });
    const finish = (code, error = "") => {
      clearTimeout(timer);
      resolve({
        code: timedOut ? 124 : code,
        out: Buffer.concat(stdout).toString("utf8"),
        err: error || Buffer.concat(stderr).toString("utf8"),
        truncated: outBytes > maxOutput || errBytes > maxOutput,
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
      // Descendants can retain pipe handles after their parent exits.
      child.stdout.destroy();
      child.stderr.destroy();
      finish(124, `Command timed out after ${timeout} ms.`);
    }, timeout);
    child.on("error", (error) => finish(1, error.message));
    child.on("close", (code) => finish(code ?? 1));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
