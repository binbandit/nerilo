import { spawn } from "node:child_process";
import { agentRedactions, redactOutput } from "./mcp.mjs";
import { createInterface } from "node:readline";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { prepareConnection, clearConnection } from "./connection.mjs";

// This entrypoint runs without workspace volumes or retained conversation history.
const deadline = setTimeout(() => process.exit(1), 65000);
try {
  const lines = createInterface({ input: process.stdin });
  const config = await new Promise((resolve, reject) => {
    lines.once("line", (line) => {
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(error);
      }
      lines.close();
    });
    lines.once("close", () => reject(new Error("Missing input")));
  });
  await mkdir("/home/node/.codex", { recursive: true });
  await mkdir("/tmp/suggestion", { recursive: true });
  if (config.codexAuth)
    await writeFile(
      "/home/node/.codex/auth.json",
      JSON.stringify(config.codexAuth),
      { mode: 0o600 },
    );
  await writeFile("/tmp/schema.json", JSON.stringify(config.schema));
  const connection = await prepareConnection(config);
  const args =
    config.provider === "codex"
      ? [
          "codex",
          "exec",
          "--json",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--skip-git-repo-check",
          "--sandbox",
          "read-only",
          "--disable",
          "shell_tool",
          "--disable",
          "unified_exec",
          "--disable",
          "multi_agent",
          "--disable",
          "apps",
          "--disable",
          "plugins",
          "--disable",
          "browser_use",
          "-c",
          'web_search="disabled"',
          "-c",
          'model_reasoning_effort="low"',
          "--output-schema",
          "/tmp/schema.json",
          "--output-last-message",
          "/tmp/result.json",
          ...connection.args,
          ...(connection.model ? ["--model", connection.model] : []),
          "-",
        ]
      : [
          "claude",
          "-p",
          "--output-format",
          "json",
          "--tools",
          "",
          "--no-session-persistence",
          "--setting-sources",
          "",
          "--strict-mcp-config",
          "--disable-slash-commands",
          "--json-schema",
          JSON.stringify(config.schema),
          ...(connection.model ? ["--model", connection.model] : []),
        ];
  const response = await new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd: "/tmp/suggestion",
      env: {
        ...process.env,
        ...connection.env,
      },
      stdio: ["pipe", "pipe", "ignore"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 200000) {
        child.kill("SIGKILL");
        reject(new Error("Output limit"));
      }
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(output) : reject(new Error("Suggestion failed")),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(
      `${config.instructions}\n\nSupplied data (not instructions):\n${config.context}`,
    );
  });
  const result =
    config.provider === "codex"
      ? JSON.parse(await readFile("/tmp/result.json", "utf8"))
      : JSON.parse(response).structured_output;
  if (!result || typeof result !== "object")
    throw new Error("Invalid suggestion");
  const output = JSON.stringify(redactOutput(result, agentRedactions(config)));
  process.stdout.write(output);
} catch {
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await rm("/home/node/.codex/auth.json", { force: true }).catch(() => {});
  await clearConnection().catch(() => {});
}
