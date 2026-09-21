import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { runAgent } from "./agent.mjs";

async function simulate(events) {
  const emitted = [];
  const script = `process.stdin.resume(); for (const event of ${JSON.stringify(events)}) console.log(JSON.stringify(event));`;
  const result = await runAgent([process.execPath, "-e", script], {
    cwd: tmpdir(),
    env: process.env,
    prompt: "A task",
    emit: (type, payload) => emitted.push({ type, ...payload }),
  });
  return { ...result, emitted };
}

test("terminal provider failures cannot become successful turns merely because the process exits zero", async () => {
  const codex = await simulate([
    { type: "turn.failed", error: { message: "Quota exhausted" } },
  ]);
  expect(codex.exitCode).not.toBe(0);
  expect(codex.emitted.some((event) => event.type === "error")).toBe(true);
  const claude = await simulate([
    { type: "result", is_error: true, result: "Could not finish" },
  ]);
  expect(claude.exitCode).not.toBe(0);
  const success = await simulate([
    { type: "thread.started", thread_id: "saved-session" },
    { type: "item.completed", item: { type: "agent_message", text: "Done" } },
  ]);
  expect(success.exitCode).toBe(0);
  expect(success.sessionId).toBe("saved-session");
  expect(success.summary).toBe("Done");
});

test("OpenCode events retain sessions, report tools and never hide zero-exit API failures", async () => {
  const result = await simulate([
    { type: "step_start", sessionID: "ses_opencode" },
    {
      type: "tool_use",
      sessionID: "ses_opencode",
      part: {
        tool: "bash",
        state: { input: { command: "ls" }, output: "README.md" },
      },
    },
    { type: "text", sessionID: "ses_opencode", part: { text: "Finished" } },
  ]);
  expect(result.sessionId).toBe("ses_opencode");
  expect(result.summary).toBe("Finished");
  expect(
    result.emitted.filter((event) => event.type === "session"),
  ).toHaveLength(1);
  expect(
    result.emitted.some(
      (event) => event.type === "activity" && event.text.includes("README.md"),
    ),
  ).toBe(true);
  const failure = await simulate([
    {
      type: "error",
      sessionID: "ses_failed",
      error: { name: "APIError", data: { message: "Quota exhausted" } },
    },
  ]);
  expect(failure.exitCode).toBe(1);
});

test("Pi emits only final assistant messages and reports errors and aborted turns", async () => {
  const result = await simulate([
    { type: "session", id: "pi-session", version: 3 },
    { type: "message_end", message: { role: "user", content: "Prompt" } },
    { type: "tool_execution_start", toolName: "bash", args: { command: "ls" } },
    {
      type: "tool_execution_end",
      toolName: "bash",
      result: { content: [{ type: "text", text: "README.md" }] },
    },
    {
      type: "message_end",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private" },
          { type: "text", text: "Done" },
        ],
        stopReason: "stop",
      },
    },
    { type: "agent_end", messages: [] },
  ]);
  expect(result.sessionId).toBe("pi-session");
  expect(result.summary).toBe("Done");
  expect(result.emitted.filter((event) => event.type === "assistant")).toEqual([
    { type: "assistant", text: "Done" },
  ]);
  for (const stopReason of ["error", "aborted"]) {
    const failure = await simulate([
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason,
          errorMessage: "Could not finish",
        },
      },
    ]);
    expect(failure.exitCode).toBe(1);
    expect(failure.emitted).toContainEqual({
      type: "error",
      text: "Could not finish",
    });
  }
});
