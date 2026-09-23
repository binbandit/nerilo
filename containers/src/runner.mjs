import { harnessArguments } from "./harnesses.mjs";
import { createInterface } from "node:readline";
import { mkdir, writeFile, rm, access } from "node:fs/promises";
import { rmSync } from "node:fs";
import { constants } from "node:os";
import {
  prepareMcpConfig,
  clearMcpConfig,
  agentRedactions,
  redactOutput,
} from "./mcp.mjs";

import { prepareSkills, clearSkills } from "./skills.mjs";

import { run } from "./process.mjs";
import { runAgent } from "./agent.mjs";
import { captureWorkspace, workspacePrepared } from "./git.mjs";
import { prepareConnection, clearConnection } from "./connection.mjs";
const codexHome = process.env.CODEX_HOME || "/home/node/.codex";
const codexAuthPath = `${codexHome}/auth.json`;
// Credentials are delivered only for the turn, not retained with session history.
// The home volume persists, so every exit path removes them, including
// process.exit and uncaught errors that skip `finally`. Other generated
// configuration lives on the container's tmpfs.
const removeCredentials = () => {
  try {
    rmSync(codexAuthPath, { force: true });
  } catch {}
};
// A previous turn may have been killed before it could clean up.
removeCredentials();
process.on("exit", removeCredentials);
// Node as PID 1 has no default SIGTERM action, so docker stop would SIGKILL it.
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => process.exit(128 + constants.signals[signal]));
let redactions = [];
const scrub = (text) => redactOutput(String(text), redactions);
let outputBytes = 0;
// Identifiers drive resume and Git operations; they are not captured tool text.
const identifiers = new Set([
  "id",
  "sessionId",
  "commit",
  "baseCommit",
  "headCommit",
  "phase",
  "status",
  "provider",
  "path",
]);
const emit = (type, payload = {}) => {
  const line =
    JSON.stringify({
      type,
      ...redactOutput(payload, redactions, identifiers),
    }) + "\n";
  outputBytes += Buffer.byteLength(line);
  if (outputBytes > 20_000_000) {
    process.stdout.write(
      JSON.stringify({
        type: "fatal",
        text: "This turn exceeded the activity log limit. Retained work can be resumed in a new turn.",
      }) + "\n",
    );
    process.exit(1);
  }
  process.stdout.write(line);
};
const exists = async (p) =>
  access(p).then(
    () => true,
    () => false,
  );
let config;
try {
  const lines = createInterface({ input: process.stdin });
  config = await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Startup input was interrupted. Retry the task.")),
      30000,
    );
    lines.once("line", (line) => {
      clearTimeout(timeout);
      try {
        resolve(JSON.parse(line));
      } catch (e) {
        reject(e);
      }
      lines.close();
    });
  });
  redactions = agentRedactions(config);
  emit("phase", {
    phase: "preparing",
    text: "Preparing the isolated workspace",
  });
  await mkdir(codexHome, { recursive: true });
  if (!workspacePrepared()) {
    await rm("/work/repo", { recursive: true, force: true });
    const clone = await run(
      ["git", "clone", "/work/source.bundle", "/work/repo"],
      { cwd: "/work" },
    );
    if (clone.code) throw new Error(clone.err);
    const checkout = await run(["git", "checkout", "-B", config.branch]);
    if (checkout.code) throw new Error(checkout.err);
    await run(["git", "config", "user.name", "Nerilo"]);
    await run(["git", "config", "user.email", "agent@nerilo.local"]);
    if (await exists("/work/changes.patch")) {
      const patch = await run([
        "git",
        "apply",
        "--binary",
        "/work/changes.patch",
      ]);
      if (patch.code) throw new Error(patch.err);
    }
    // Removing the bundle marks preparation complete; it must come last.
    await rm("/work/source.bundle", { force: true });
    await rm("/work/changes.patch", { force: true });
  }
  const base =
    config.baseCommit || (await run(["git", "rev-parse", "HEAD"])).out.trim();
  emit("base", { commit: base });
  if (config.setup && !config.readOnly) {
    emit("activity", { text: "Preparing project: " + config.setup });
    const setup = await run(["sh", "-lc", config.setup], { timeout: 300000 });
    emit("activity", { text: (setup.out + setup.err).slice(-30000) });
    if (setup.code)
      throw new Error("Project preparation failed. " + setup.err.slice(-2000));
  }
  if (config.codexAuth)
    await writeFile(codexAuthPath, JSON.stringify(config.codexAuth), {
      mode: 0o600,
    });
  emit("phase", { phase: "working", text: "Agent is working" });
  let sessionId = config.sessionId ?? null,
    summary = "",
    exitCode = 0;
  if (config.fixture) {
    await writeFile("/work/repo/nerilo-smoke.txt", config.prompt + "\n");
    emit("assistant", {
      text: "Created nerilo-smoke.txt inside the isolated task workspace.",
    });
    await new Promise((resolve) =>
      setTimeout(resolve, config.fixtureDelay ?? 200),
    );
    summary = "Container execution verified.";
  } else {
    const mcp = await prepareMcpConfig(config.provider, config.mcpServers);
    const skills = await prepareSkills(config.provider, config.skills);
    const connection = await prepareConnection(config);
    const args = ["opencode", "pi"].includes(config.provider)
      ? harnessArguments(config, connection, skills)
      : config.provider === "codex"
        ? [
            "codex",
            "exec",
            ...(sessionId ? ["resume", sessionId] : []),
            "--json",
            "--ignore-user-config",
            "--ignore-rules",
            "--dangerously-bypass-approvals-and-sandbox",
            ...connection.args,
            ...(connection.model ? ["-m", connection.model] : []),
            ...(config.effort
              ? [
                  "-c",
                  `model_reasoning_effort=${JSON.stringify(config.effort)}`,
                ]
              : []),
            "-",
          ]
        : [
            "claude",
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            "--dangerously-skip-permissions",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            ...mcp.args,
            ...skills.args,
            ...(sessionId ? ["--resume", sessionId] : []),
            ...(connection.model ? ["--model", connection.model] : []),
            ...(config.effort ? ["--effort", config.effort] : []),
          ];
    const env = {
      ...process.env,
      ...connection.env,
      ...mcp.env,
    };
    ({ exitCode, summary, sessionId } = await runAgent(args, {
      env,
      prompt: config.prompt,
      sessionId,
      emit,
    }));
  }
  await rm(codexAuthPath, { force: true });
  await clearMcpConfig();
  await clearSkills();
  await clearConnection();
  let verification = null;
  if (config.verify && exitCode === 0) {
    emit("phase", { phase: "checking", text: "Running " + config.verify });
    const check = await run(["sh", "-lc", config.verify], { timeout: 300000 });
    verification = {
      command: config.verify,
      exitCode: check.code,
      output: scrub((check.out + check.err).slice(-50000)),
    };
    emit("check", {
      text: `${check.code === 0 ? "Passed" : "Failed"}: ${config.verify}\n${verification.output}`,
    });
  }
  const workspace = await captureWorkspace(base);
  const safeDiff = scrub(workspace.diff);
  emit("result", {
    result: {
      exitCode,
      sessionId,
      summary: scrub(summary),
      ...workspace,
      diff: safeDiff,
      verification,
      baseCommit: base,
      // A redacted patch is no longer an exact copy of the workspace.
      truncated: workspace.truncated || safeDiff !== workspace.diff,
    },
  });
} catch (error) {
  emit("fatal", {
    text: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
} finally {
  removeCredentials();
  await clearMcpConfig().catch(() => {});
  await clearSkills().catch(() => {});
  await clearConnection().catch(() => {});
}
