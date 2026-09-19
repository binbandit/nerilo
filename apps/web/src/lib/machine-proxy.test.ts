import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST } from "../app/api/[...path]/route";
import { machineSchema } from "@nerilo/protocol";

test("machine proxy preserves authentication, routes every resource to its owner, and recovers while local daemon is offline", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-machine-proxy-"));
  const previous = {
    data: process.env.NERILO_DATA_DIR,
    daemon: process.env.NERILO_DAEMON_PORT,
    web: process.env.NERILO_WEB_PORT,
  };
  const localId = randomUUID();
  let remoteId = randomUUID();
  const localToken = "test-local-secret-token";
  const remoteToken = "test-remote-secret-token";
  const forwarded: {
    path: string;
    method: string;
    key: string | null;
    body: string;
  }[] = [];
  const local = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      return Response.json({ local: true });
    },
  });
  const remote = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.headers.get("authorization") !== `Bearer ${remoteToken}`)
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      const url = new URL(request.url);
      if (url.pathname === "/machine")
        return Response.json({
          id: remoteId,
          name: "worker",
          platform: "linux",
          protocolVersion: 1,
        });
      forwarded.push({
        path: `${url.pathname}${url.search}`,
        method: request.method,
        key: request.headers.get("idempotency-key"),
        body: await request.text(),
      });
      if (url.pathname === "/events")
        return new Response("data: remote-event\n\n", {
          headers: { "Content-Type": "text/event-stream" },
        });
      if (url.pathname.endsWith("/patch"))
        return new Response("remote-patch", {
          headers: {
            "Content-Type": "text/plain",
            "Content-Disposition": "attachment; filename=change.patch",
          },
        });
      return Response.json({ remote: true });
    },
  });
  try {
    await writeFile(join(directory, "daemon-token"), localToken);
    await writeFile(join(directory, "machine-id"), localId);
    process.env.NERILO_DATA_DIR = directory;
    process.env.NERILO_DAEMON_PORT = String(local.port);
    process.env.NERILO_WEB_PORT = "5285";
    let cookie = "";
    const call = (
      path: string,
      options: {
        machine?: string;
        body?: unknown;
        cookie?: string;
        host?: string;
        origin?: string;
        key?: string;
      } = {},
    ) => {
      const url = new URL(`http://127.0.0.1:5285/api/${path}`);
      if (options.machine) url.searchParams.set("machine", options.machine);
      const method = options.body === undefined ? "GET" : "POST";
      const request = new Request(url, {
        method,
        headers: {
          host: options.host ?? "127.0.0.1:5285",
          origin: options.origin ?? "http://127.0.0.1:5285",
          cookie: options.cookie ?? cookie,
          "Content-Type": "application/json",
          ...(options.key ? { "Idempotency-Key": options.key } : {}),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
      return (method === "POST" ? POST : GET)(request, {
        params: Promise.resolve({ path: url.pathname.slice(5).split("/") }),
      });
    };
    expect((await call("machines")).status).toBe(401);
    expect((await call("bootstrap", { host: "evil.example" })).status).toBe(
      403,
    );
    expect(
      (await call("bootstrap", { origin: "https://evil.example" })).status,
    ).toBe(403);
    await local.stop(true);
    const offline = await call("bootstrap");
    expect(offline.status).toBe(503);
    cookie = offline.headers.get("set-cookie")?.split(";")[0] ?? "";
    expect(cookie).toContain("nerilo-session-5285=");
    const registered = await call("machines", {
      machine: "does-not-exist",
      body: {
        name: "Worker",
        url: `http://127.0.0.1:${remote.port}`,
        token: remoteToken,
        machineId: remoteId,
      },
    });
    expect(registered.status).toBe(200);
    const machine = machineSchema.parse(await registered.json());
    const bootstrapped = await call("bootstrap", { machine: machine.id });
    expect(await bootstrapped.json()).toEqual({ remote: true });
    const key = randomUUID();
    const prompt = { prompt: "Run on this machine only" };
    expect(
      (await call("tasks", { machine: machine.id, body: prompt, key })).status,
    ).toBe(200);
    expect(forwarded.at(-1)).toEqual({
      path: "/tasks",
      method: "POST",
      key,
      body: JSON.stringify(prompt),
    });
    const events = await call("events?after=12", { machine: machine.id });
    expect(await events.text()).toContain("remote-event");
    expect(forwarded.at(-1)?.path).toBe("/events?after=12");
    const patch = await call("tasks/test/patch", { machine: machine.id });
    expect(await patch.text()).toBe("remote-patch");
    expect(patch.headers.get("content-disposition")).toContain("change.patch");
    const count = forwarded.length;
    expect(
      (await call("tasks", { machine: randomUUID(), body: prompt })).status,
    ).toBe(404);
    remoteId = randomUUID();
    const wrongMachine = await call("tasks", {
      machine: machine.id,
      body: prompt,
    });
    expect(wrongMachine.status).toBe(409);
    expect(await wrongMachine.text()).toContain("different machine");
    expect(forwarded).toHaveLength(count);
    expect((await call("machines", { machine: machine.id })).status).toBe(200);
    expect(
      (await call("machines", { body: { token: remoteToken } })).status,
    ).toBe(400);
    expect(
      (
        await call("machines", {
          body: { token: remoteToken },
          cookie: "wrong-session",
        })
      ).status,
    ).toBe(401);
  } finally {
    await local.stop(true);
    await remote.stop(true);
    for (const [key, value] of [
      ["NERILO_DATA_DIR", previous.data],
      ["NERILO_DAEMON_PORT", previous.daemon],
      ["NERILO_WEB_PORT", previous.web],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
