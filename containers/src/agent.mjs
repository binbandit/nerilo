import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

export async function runAgent(
  args,
  { cwd = "/work/repo", env, prompt, sessionId = null, emit },
) {
  let summary = "",
    failed = false;
  const exitCode = await new Promise((resolve) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = createInterface({ input: child.stdout });
    let bytes = 0;
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 20_000_000) {
        failed = true;
        output.close();
        child.stdout.destroy();
        child.kill("SIGKILL");
      }
    });
    let stderr = "";
    output.on("line", (line) => {
      try {
        const e = JSON.parse(line);
        // OpenCode emits sessionID on every event; Pi starts with a session header.
        const nextSession = e.sessionID ?? (e.type === "session" ? e.id : null);
        if (nextSession && nextSession !== sessionId) {
          sessionId = nextSession;
          emit("session", { id: sessionId });
        }
        if (e.type === "text" && typeof e.part?.text === "string") {
          summary = e.part.text;
          emit("assistant", { text: summary });
        }
        if (e.type === "tool_use" && e.part)
          emit("activity", {
            text: `${e.part.tool} ${JSON.stringify(e.part.state ?? {}).slice(0, 20000)}`,
          });
        if (e.type === "message_end" && e.message?.role === "assistant") {
          const text = (e.message.content ?? [])
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          if (text) {
            summary = text;
            emit("assistant", { text });
          }
          if (["error", "aborted"].includes(e.message.stopReason)) {
            failed = true;
            emit("error", {
              text:
                e.message.errorMessage ||
                "The agent could not finish this turn.",
            });
          }
        }
        if (["tool_execution_start", "tool_execution_end"].includes(e.type))
          emit("activity", {
            text: `${e.toolName} ${JSON.stringify(e.args ?? e.result ?? {}).slice(0, 20000)}`,
          });
        if (e.type === "thread.started") {
          sessionId = e.thread_id;
          emit("session", { id: sessionId });
        }
        if (e.type === "system" && e.session_id) {
          sessionId = e.session_id;
          emit("session", { id: sessionId });
        }
        if (e.type === "item.completed" && e.item?.type === "agent_message") {
          summary = e.item.text;
          emit("assistant", { text: summary });
        } else if (e.type === "item.completed") {
          emit("activity", {
            text: e.item?.command
              ? `${e.item.command}\n${e.item.aggregated_output ?? ""}`
              : JSON.stringify(e.item).slice(0, 20000),
          });
        }
        if (e.type === "assistant") {
          for (const content of e.message?.content ?? []) {
            if (content.type === "text") {
              summary = content.text;
              emit("assistant", { text: content.text });
            } else if (content.type === "tool_use")
              emit("activity", {
                text:
                  content.name +
                  " " +
                  JSON.stringify(content.input).slice(0, 12000),
              });
          }
        }
        if (e.type === "result") {
          if (e.result) summary = e.result;
          if (e.is_error) {
            failed = true;
            emit("error", { text: e.result ?? JSON.stringify(e.errors) });
          }
        }
        if (e.type === "turn.failed" || e.type === "error") failed = true;
        if (e.type === "error" || e.type === "turn.failed")
          emit("error", { text: e.message ?? JSON.stringify(e.error) });
      } catch {
        emit("activity", { text: line.slice(0, 20000) });
      }
    });
    child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-30000)));
    child.on("error", (e) => {
      emit("error", { text: e.message });
      resolve(1);
    });
    child.on("close", (code) => {
      if (code && stderr) emit("error", { text: stderr });
      resolve(failed && code === 0 ? 1 : (code ?? 1));
    });
    // A CLI can reject configuration before reading the prompt. Its exit
    // status reports the failure; EPIPE must not bypass credential cleanup.
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
  return { exitCode, summary, sessionId };
}
