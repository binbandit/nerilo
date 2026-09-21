// Exercise the installed agent CLIs against a local TLS gateway, without real credentials.
import { createServer } from "node:https";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { resultSchema } from "../../packages/protocol/src/index";

const directory = await mkdtemp(join(tmpdir(), "nerilo-gateway-smoke-"));
process.env.NERILO_DATA_DIR = directory;
const { command, checked } =
  await import("../../apps/daemon/src/platform/config");
const { createProviderNetwork, providerNetworkArgs, cleanupProviderNetwork } =
  await import("../../apps/daemon/src/sandbox/sandbox-network");
const image = process.env.NERILO_TEST_IMAGE ?? "nerilo-agent:1";
const requests: { path: string; model: string; authorized: boolean }[] = [];
const key = "nerilo-fixture-gateway-secret";
let server: ReturnType<typeof createServer> | null = null;
let running: string | null = null;
const volumes: string[] = [];
try {
  await checked([
    "openssl",
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "ca-key.pem"),
    "-out",
    join(directory, "ca.pem"),
    "-days",
    "1",
    "-subj",
    "/CN=Nerilo test CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  ]);
  await checked([
    "openssl",
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(directory, "key.pem"),
    "-out",
    join(directory, "request.pem"),
    "-subj",
    "/CN=host.docker.internal",
  ]);
  await writeFile(
    join(directory, "extensions.cnf"),
    "subjectAltName=DNS:host.docker.internal\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n",
  );
  await checked([
    "openssl",
    "x509",
    "-req",
    "-in",
    join(directory, "request.pem"),
    "-CA",
    join(directory, "ca.pem"),
    "-CAkey",
    join(directory, "ca-key.pem"),
    "-CAcreateserial",
    "-out",
    join(directory, "server.pem"),
    "-days",
    "1",
    "-extfile",
    join(directory, "extensions.cnf"),
  ]);
  const certificate = await readFile(join(directory, "ca.pem"), "utf8");
  server = createServer({
    key: await readFile(join(directory, "key.pem")),
    cert: await readFile(join(directory, "server.pem")),
  });
  server.on("request", async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = JSON.parse(raw || "{}") as {
      model?: string;
      tools?: { name?: string }[];
    };
    const authorized =
      request.headers.authorization === `Bearer ${key}` ||
      request.headers["x-api-key"] === key;
    requests.push({
      path: request.url ?? "",
      model: body.model ?? "",
      authorized,
    });
    if (
      !authorized ||
      requests.length > 60 ||
      request.headers["x-gateway-fixture"] !== "required-header"
    ) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (request.url?.includes("count_tokens")) {
      response.setHeader("content-type", "application/json");
      response.end('{"input_tokens":1}');
      return;
    }
    response.setHeader("content-type", "text/event-stream");
    const event = (type: string, data: unknown) =>
      response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    if (request.url?.includes("responses")) {
      const item = {
        id: `msg_fixture_${requests.length}`,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: '{"ok":true}', annotations: [] },
        ],
      };
      event("response.created", {
        type: "response.created",
        response: { id: "resp_fixture", status: "in_progress", output: [] },
      });
      event("response.output_item.added", {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      });
      event("response.content_part.added", {
        type: "response.content_part.added",
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        part: { type: "output_text", text: "", annotations: [] },
      });
      event("response.output_text.delta", {
        type: "response.output_text.delta",
        output_index: 0,
        content_index: 0,
        item_id: item.id,
        delta: '{"ok":true}',
      });
      event("response.output_item.done", {
        type: "response.output_item.done",
        output_index: 0,
        item,
      });
      event("response.completed", {
        type: "response.completed",
        response: {
          id: "resp_fixture",
          status: "completed",
          output: [item],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
      });
    } else {
      const structured = body.tools?.some(
        (tool) => tool.name === "StructuredOutput",
      );
      event("message_start", {
        type: "message_start",
        message: {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      });
      event("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: structured
          ? {
              type: "tool_use",
              id: "toolu_fixture",
              name: "StructuredOutput",
              input: {},
            }
          : { type: "text", text: "" },
      });
      event("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: structured
          ? { type: "input_json_delta", partial_json: '{"ok":true}' }
          : { type: "text_delta", text: '{"ok":true}' },
      });
      event("content_block_stop", { type: "content_block_stop", index: 0 });
      event("message_delta", {
        type: "message_delta",
        delta: {
          stop_reason: structured ? "tool_use" : "end_turn",
          stop_sequence: null,
        },
        usage: { output_tokens: 1 },
      });
      event("message_stop", { type: "message_stop" });
    }
    response.end();
  });
  await new Promise<void>((resolve) => server!.listen(0, "0.0.0.0", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  for (const provider of ["codex", "claude"] as const) {
    const id = `nerilo-gateway-smoke-${crypto.randomUUID()}`;
    running = id;
    const baseUrl = `https://host.docker.internal:${address.port}${provider === "codex" ? "/v1" : ""}`;
    await createProviderNetwork(id, id, provider, image, baseUrl);
    const preflight = await command(
      [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        `${id}-probe`,
        ...providerNetworkArgs(id),
        "--entrypoint",
        "sh",
        image,
        "-c",
        'cat > /tmp/ca.pem; curl -sS --max-time 10 --cacert /tmp/ca.pem -H "Authorization: Bearer nerilo-fixture-gateway-secret" -H "x-gateway-fixture: required-header" -d "{}" "$1/health"',
        "sh",
        baseUrl,
      ],
      { input: certificate, timeout: 15000 },
    );
    assert.equal(
      preflight.code,
      0,
      `Gateway TLS preflight failed: ${preflight.stderr}`,
    );
    const before = requests.length;
    const config = {
      provider,
      model: "",
      instructions: "Return the requested object with ok true.",
      context: "Connection check",
      schema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
        required: ["ok"],
        additionalProperties: false,
      },
      gateway: {
        baseUrl,
        model: provider === "codex" ? "@fixture/codex" : "opus",
        key,
        authHeader: provider === "codex" ? "authorization" : "x-api-key",
        headers: { "x-gateway-fixture": "required-header" },
        env: {
          ANTHROPIC_DEFAULT_OPUS_MODEL: "@fixture/opus",
          CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: "1",
        },
        caCertificate: certificate,
      },
    };
    const result = await command(
      [
        "docker",
        "run",
        "--rm",
        "-i",
        "--name",
        id,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--cpus=1",
        "--memory=1g",
        "--tmpfs",
        "/tmp:rw,nosuid,size=128m,mode=1777",
        "--tmpfs",
        "/home/node:rw,nosuid,size=128m,uid=1000,gid=1000",
        ...providerNetworkArgs(id),
        "--entrypoint",
        "node",
        image,
        "/opt/nerilo/metadata.mjs",
      ],
      { input: JSON.stringify(config) + "\n", timeout: 75000 },
    );
    assert.equal(
      result.code,
      0,
      `${provider} failed (${result.code}); requests: ${JSON.stringify(requests.slice(before))}; ${result.stderr}`,
    );
    assert.deepEqual(JSON.parse(result.stdout), { ok: true });
    assert(
      requests
        .slice(before)
        .some(
          (request) =>
            request.model ===
            (provider === "codex" ? "@fixture/codex" : "@fixture/opus"),
        ),
    );
    assert(requests.slice(before).every((request) => request.authorized));
    const blocked = await command([
      "docker",
      "run",
      "--rm",
      "--name",
      `${id}-blocked`,
      ...providerNetworkArgs(id),
      "--entrypoint",
      "curl",
      image,
      "-sS",
      "--max-time",
      "10",
      provider === "codex"
        ? "https://api.openai.com/"
        : "https://api.anthropic.com/",
    ]);
    assert.notEqual(
      blocked.code,
      0,
      "Gateway connections must not fall back to the public provider.",
    );

    const work = `${id}-work`,
      home = `${id}-home`;
    volumes.push(work, home);
    const mounts = [
      "--mount",
      `type=volume,source=${work},target=/work`,
      "--mount",
      `type=volume,source=${home},target=/home/node`,
    ];
    await checked([
      "docker",
      "run",
      "--rm",
      "--name",
      `${id}-seed`,
      "--user",
      "root",
      "--network=none",
      ...mounts,
      "--entrypoint",
      "sh",
      image,
      "-eu",
      "-c",
      "mkdir -p /work/repo; git -C /work/repo init -b fixture; git -C /work/repo config user.name Fixture; git -C /work/repo config user.email fixture@example.test; git -C /work/repo commit --allow-empty -m Initial; chown -R node:node /work /home/node",
    ]);
    let sessionId: string | null = null;
    for (const turn of [0, 1]) {
      const completed = await command(
        [
          "docker",
          "run",
          "--rm",
          "-i",
          "--name",
          `${id}-task-${turn}`,
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--cpus=1",
          "--memory=1g",
          "--pids-limit=256",
          "--tmpfs",
          "/tmp:rw,nosuid,size=128m,mode=1777",
          ...mounts,
          ...providerNetworkArgs(id),
          image,
        ],
        {
          input:
            JSON.stringify({
              provider,
              model: "",
              gateway: config.gateway,
              sessionId,
              branch: "fixture",
              prompt:
                "Return exactly the object with ok true. Do not use tools.",
              verify:
                'test ! -e /tmp/nerilo-gateway-ca.pem && test -z "$ANTHROPIC_API_KEY$ANTHROPIC_AUTH_TOKEN$NERILO_GATEWAY_HEADER_0" && git rev-parse --verify HEAD',
            }) + "\n",
          timeout: 75000,
        },
      );
      assert.equal(
        completed.code,
        0,
        `${provider} task failed: ${completed.stderr}\n${completed.stdout}`,
      );
      assert(
        !completed.stdout.includes(key),
        "Task activity must not reveal credentials.",
      );
      const events = completed.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as { type: string; result?: unknown });
      const result = resultSchema.parse(
        events.find((event) => event.type === "result")?.result,
      );
      assert.equal(
        result.exitCode,
        0,
        `${provider} did not complete its turn.`,
      );
      assert.equal(
        result.verification?.exitCode,
        0,
        "Verification must run without gateway credentials or certificate files.",
      );
      assert(
        result.sessionId,
        "An agent session must be retained for follow-ups.",
      );
      if (turn)
        assert.equal(
          result.sessionId,
          sessionId,
          "The follow-up must resume the same agent session.",
        );
      sessionId = result.sessionId;
    }
    assert(requests.slice(before).every((request) => request.authorized));
    console.log(
      `${provider}: real CLI, TLS trust, model routing, headers, connection check, first turn, session resume, credential-free verification, and public endpoint blocking passed`,
    );
    await cleanupProviderNetwork(id);
    running = null;
  }
} finally {
  if (running) {
    await command([
      "docker",
      "rm",
      "-f",
      running,
      `${running}-blocked`,
      `${running}-probe`,
      `${running}-seed`,
      `${running}-task-0`,
      `${running}-task-1`,
    ]).catch(() => {});
    await cleanupProviderNetwork(running);
  }
  if (volumes.length) await command(["docker", "volume", "rm", ...volumes]);
  server?.closeAllConnections();
  server?.close();
  await rm(directory, { recursive: true, force: true });
}
