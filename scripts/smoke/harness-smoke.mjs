import assert from "node:assert/strict";
import http from "node:http";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Run the pinned, unmodified CLIs against a deterministic local API. No model
// credentials, host credential mounts or external network access are used.
if (!process.env.NERILO_HARNESS_SMOKE_INNER) {
  const container = `nerilo-harness-smoke-${crypto.randomUUID()}`;
  let result;
  try {
    result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        container,
        "--network=none",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--tmpfs",
        "/tmp:rw,mode=1777",
        "--tmpfs",
        "/home/node:rw,uid=1000,gid=1000",
        "--tmpfs",
        "/work:rw,uid=1000,gid=1000",
        "--mount",
        `type=bind,source=${fileURLToPath(import.meta.url)},target=/smoke.mjs,readonly`,
        "--env",
        "NERILO_HARNESS_SMOKE_INNER=1",
        "--entrypoint",
        "node",
        process.env.NERILO_SMOKE_IMAGE || "nerilo-agent:1",
        "/smoke.mjs",
      ],
      { stdio: "inherit", timeout: 120000 },
    );
  } finally {
    spawnSync("docker", ["rm", "-f", container], {
      stdio: "ignore",
      timeout: 10000,
    });
  }
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
const { harnessArguments, harnessConnection } =
  await import("/opt/nerilo/harnesses.mjs");
const { runAgent } = await import("/opt/nerilo/agent.mjs");
const { prepareSkills, clearSkills } = await import("/opt/nerilo/skills.mjs");
let requests = [];
let rejectRequests = false;
let metadataRequest = false;
const server = http.createServer(async (req, res) => {
  let data = "";
  for await (const chunk of req) data += chunk;
  const body = JSON.parse(data);
  requests.push(body);
  if (rejectRequests) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        type: "error",
        error: {
          type: "authentication_error",
          message: "Fixture authentication rejected",
        },
      }),
    );
    return;
  }
  const tool = body.tools?.find((t) => t.name === "bash");
  const hasResult = body.messages.some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((c) => c.type === "tool_result"),
  );
  const useTool = tool && !hasResult;
  const block = useTool
    ? {
        type: "tool_use",
        id: "tool_1",
        name: "bash",
        input: {
          command: "printf verified > /tmp/harness-tool-result",
          description: "Verify tool execution",
        },
      }
    : {
        type: "text",
        text: metadataRequest ? '{"ok":true}' : "Harness verified",
      };
  const message = {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model: body.model,
    content: [block],
    stop_reason: useTool ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  };
  if (!body.stream) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(message));
    return;
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const send = (type, data) =>
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  send("message_start", {
    message: {
      ...message,
      content: [],
      stop_reason: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    },
  });
  send("content_block_start", {
    index: 0,
    content_block: useTool
      ? { ...block, input: {} }
      : { type: "text", text: "" },
  });
  send("content_block_delta", {
    index: 0,
    delta: useTool
      ? { type: "input_json_delta", partial_json: JSON.stringify(block.input) }
      : { type: "text_delta", text: block.text },
  });
  send("content_block_stop", { index: 0 });
  send("message_delta", {
    delta: { stop_reason: message.stop_reason, stop_sequence: null },
    usage: { output_tokens: 5 },
  });
  send("message_stop", {});
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
await mkdir("/work/repo", { recursive: true });
try {
  for (const provider of ["opencode", "pi"]) {
    requests = [];
    const config = {
      provider,
      model: "anthropic/claude-sonnet-4-6",
      harnessKeys: { anthropic: "fixture-anthropic-secret" },
    };
    const connection = harnessConnection(config);
    const skills = await prepareSkills(provider, [
      {
        name: "harness-smoke-skill",
        enabled: true,
        files: [
          {
            path: "SKILL.md",
            content:
              "---\nname: harness-smoke-skill\ndescription: A fixture skill for harness validation.\n---\nReport fixture results.\n",
          },
        ],
      },
    ]);
    if (provider === "opencode") {
      const oc = JSON.parse(connection.env.OPENCODE_CONFIG_CONTENT);
      oc.provider.anthropic.options.baseURL = baseURL;
      connection.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(oc);
    } else {
      await mkdir("/home/node/.pi/agent", { recursive: true });
      await writeFile(
        "/home/node/.pi/agent/models.json",
        JSON.stringify({ providers: { anthropic: { baseUrl: baseURL } } }),
      );
    }
    const events = [];
    const first = await runAgent(harnessArguments(config, connection, skills), {
      env: { ...process.env, ...connection.env },
      prompt: "Run the bash tool, then reply.",
      emit: (type, payload) => events.push({ type, ...payload }),
    });
    console.log(
      provider,
      JSON.stringify(first),
      JSON.stringify(events.filter((e) => e.type === "error")),
    );
    assert.equal(first.exitCode, 0);
    assert.equal(first.summary, "Harness verified");
    assert.ok(first.sessionId);
    assert.equal(
      await readFile("/tmp/harness-tool-result", "utf8"),
      "verified",
    );
    assert.ok(events.some((e) => e.type === "activity"));
    assert.ok(
      requests.some((body) =>
        JSON.stringify(body).includes("harness-smoke-skill"),
      ),
    );
    const previousCount = requests.length;
    const second = await runAgent(
      harnessArguments({ ...config, sessionId: first.sessionId }, connection),
      {
        env: { ...process.env, ...connection.env },
        prompt: "Continue the same session.",
        sessionId: first.sessionId,
        emit: (type, payload) => events.push({ type, ...payload }),
      },
    );
    assert.equal(second.exitCode, 0);
    assert.equal(second.sessionId, first.sessionId);
    assert.equal(second.summary, "Harness verified");
    assert.ok(
      requests.slice(previousCount).some((body) => body.messages.length > 2),
    );
    metadataRequest = true;
    const metadataConfig = { ...config, metadata: true };
    const metadataConnection = harnessConnection(metadataConfig);
    if (provider === "opencode") {
      const oc = JSON.parse(metadataConnection.env.OPENCODE_CONFIG_CONTENT);
      oc.provider.anthropic.options.baseURL = baseURL;
      metadataConnection.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(oc);
    }
    const metadataEvents = [];
    const metadata = await runAgent(
      harnessArguments(metadataConfig, metadataConnection),
      {
        cwd: "/tmp",
        env: { ...process.env, ...metadataConnection.env },
        prompt: 'Return only JSON: {"ok":true}. Do not use tools.',
        emit: (type, payload) => metadataEvents.push({ type, ...payload }),
      },
    );
    assert.equal(metadata.exitCode, 0);
    assert.deepEqual(JSON.parse(metadata.summary), { ok: true });
    assert.ok(!metadataEvents.some((event) => event.type === "activity"));
    metadataRequest = false;
    rejectRequests = true;
    const failedEvents = [];
    const failed = await runAgent(harnessArguments(config, connection), {
      env: { ...process.env, ...connection.env },
      prompt: "Check authentication.",
      emit: (type, payload) => failedEvents.push({ type, ...payload }),
    });
    assert.notEqual(failed.exitCode, 0);
    assert.ok(failedEvents.some((event) => event.type === "error"));
    rejectRequests = false;
    console.log(
      `${provider}: tools, streamed output, session resume, metadata and API failures passed`,
    );
    await clearSkills();
  }
} finally {
  server.closeAllConnections();
  server.close();
}
