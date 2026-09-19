import { mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readPrivateFile } from "./private-file";

export const dataDir =
  process.env.NERILO_DATA_DIR ?? join(homedir(), ".nerilo");
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
chmodSync(dataDir, 0o700);
export const rootDir = resolve(import.meta.dirname, "../../..");
export const tokenPath = join(dataDir, "daemon-token");
export const token = readPrivateFile(
  tokenPath,
  () => crypto.randomUUID() + crypto.randomUUID(),
).trim();
if (!/^[\x21-\x7E]{32,4096}$/.test(token))
  throw new Error(
    "The daemon token is invalid. Restore daemon-token from a backup.",
  );
export const port = Number(process.env.NERILO_DAEMON_PORT ?? 5186);
export const imageTag = process.env.NERILO_AGENT_IMAGE ?? "nerilo-agent:1";
export const now = () => new Date().toISOString();

export async function command(
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    timeout?: number;
    env?: Record<string, string>;
    outputTail?: number;
  } = {},
) {
  const child = Bun.spawn(args, {
    cwd: options.cwd,
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...options.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let timedOut = false;
  let overflow = false;
  const stop = () => {
    child.kill("SIGKILL");
    for (const reader of readers) void reader.cancel().catch(() => {});
  };
  const read = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > 32 * 1024 * 1024) {
        overflow = true;
        stop();
        return text;
      }
      text += decoder.decode(chunk.value, { stream: true });
      if (options.outputTail !== undefined)
        text = text.slice(-options.outputTail);
    }
  };
  const timer = setTimeout(() => {
    timedOut = true;
    stop();
  }, options.timeout ?? 30000);
  try {
    if (
      options.input !== undefined &&
      child.stdin &&
      typeof child.stdin !== "number"
    ) {
      child.stdin.write(options.input);
      child.stdin.end();
    }
    const [stdout, stderr, code] = await Promise.all([
      read(readers[0]),
      read(readers[1]),
      child.exited,
    ]);
    if (overflow) throw new Error("Command output exceeded the 32 MB limit.");
    return {
      stdout,
      stderr: timedOut
        ? `Command timed out after ${options.timeout ?? 30000} ms.\n${stderr}`
        : stderr,
      code: timedOut ? 124 : code,
    };
  } catch (error) {
    stop();
    throw error;
  } finally {
    clearTimeout(timer);
    for (const reader of readers) reader.releaseLock();
  }
}
export async function checked(
  args: string[],
  options: Parameters<typeof command>[1] = {},
) {
  const r = await command(args, options);
  if (r.code !== 0)
    throw new Error(
      r.stderr.trim() || r.stdout.trim() || `${args[0]} failed (${r.code})`,
    );
  return r.stdout.trim();
}
