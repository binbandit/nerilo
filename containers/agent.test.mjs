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
