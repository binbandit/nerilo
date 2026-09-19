import { expect, spyOn, test } from "bun:test";
import { runtimeSchema } from "@nerilo/protocol";
import { disconnect } from "./credentials";
import { Store } from "./store";
import { Engine } from "./engine";
import { createApi } from "./api";

test("gateway settings round-trip through the API without exposing credentials", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store, true);
  const runtime = spyOn(engine, "runtime").mockResolvedValue(
    runtimeSchema.parse({
      docker: true,
      image: true,
      building: false,
      buildLog: "",
      connections: {
        codex: { ready: false, source: "", canImport: false },
        claude: { ready: true, source: "", canImport: false },
      },
    }),
  );
  const api = createApi(store, engine, "fixture");
  const request = (method: string, path: string, body?: unknown) =>
    api(
      new Request(`http://localhost/${path}`, {
        method,
        headers: { Authorization: "Bearer fixture" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
  try {
    const saved = await request("POST", "connections/claude/gateway", {
      baseUrl: "https://gateway.example.test",
      model: "opusplan",
      credential: { type: "key", value: "fixture-gateway-key" },
      headers: { "x-portkey-provider": "fixture-private-header" },
      env: { ANTHROPIC_DEFAULT_OPUS_MODEL: "@bedrock-test/opus" },
    });
    expect(saved.status).toBe(200);
    const response = await request("GET", "connections/claude/gateway");
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain("fixture-gateway-key");
    expect(text).not.toContain("fixture-private-header");
    expect(JSON.parse(text)).toMatchObject({
      baseUrl: "https://gateway.example.test",
      model: "opusplan",
      credential: { type: "key", configured: true },
      headerNames: ["x-portkey-provider"],
    });
    const invalid = await request("POST", "connections/claude/gateway", {
      baseUrl: "https://user:secret@gateway.example.test",
      model: "opus",
      credential: { type: "key", value: "fixture-gateway-key" },
    });
    expect(invalid.status).toBe(400);
    const after = await request("GET", "connections/claude/gateway");
    expect((await after.json()).model).toBe("opusplan");
  } finally {
    await disconnect("claude");
    runtime.mockRestore();
    store.db.close();
  }
});
