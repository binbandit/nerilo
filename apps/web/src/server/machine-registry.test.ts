import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { MachineRegistry, machineUrl } from "@/server/machine-registry";

const temporary: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), "nerilo-machines-"));
  temporary.push(path);
  const localId = randomUUID();
  await writeFile(join(path, "machine-id"), localId);
  const remoteId = randomUUID();
  const local = { url: "http://127.0.0.1:5186", token: "local-private-token" };
  const requests: { url: string; init?: RequestInit }[] = [];
  const states = new Map<string, { id: string; token: string }>([
    [local.url, { id: localId, token: local.token }],
    ["https://worker.example", { id: remoteId, token: "remote-private-token" }],
  ]);
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    const state = states.get(new URL(url).origin);
    if (!state) throw new Error("Connection refused");
    if (
      new Headers(init?.headers).get("authorization") !==
      `Bearer ${state.token}`
    )
      return Response.json({}, { status: 401 });
    return Response.json({
      id: state.id,
      name: "worker",
      platform: "linux",
      protocolVersion: 1,
    });
  };
  return {
    path,
    localId,
    remoteId,
    local,
    requests,
    states,
    registry: new MachineRegistry(path, local, fetcher),
  };
}
const registration = {
  name: "Build machine",
  url: "https://worker.example/",
  token: "remote-private-token",
};

test("machine URLs require secure transport or a loopback tunnel", () => {
  expect(machineUrl("https://worker.example/")).toBe("https://worker.example");
  expect(machineUrl("http://[::1]:5190/")).toBe("http://[::1]:5190");
  for (const value of [
    "http://192.168.1.5:5186",
    "ftp://localhost",
    "https://user:pass@worker.example",
    "https://worker.example/api",
    "https://worker.example?secret=x",
    "https://worker.example#fragment",
  ])
    expect(() => machineUrl(value)).toThrow();
});

test("registration pins daemon identity, stores credentials privately, and excludes them from public responses", async () => {
  const { registry, path, remoteId, requests } = await fixture();
  const machine = await registry.register({
    ...registration,
    machineId: remoteId,
  });
  expect(machine.daemonId).toBe(remoteId);
  expect(machine.status).toBe("online");
  expect((await stat(join(path, "machines.json"))).mode & 0o777).toBe(0o600);
  expect(await readFile(join(path, "machines.json"), "utf8")).toContain(
    registration.token,
  );
  const list = await registry.list();
  expect(list.machines.map((item) => item.id)).toEqual(["local", machine.id]);
  expect(JSON.stringify(machine)).not.toContain(registration.token);
  expect(JSON.stringify(list)).not.toContain("token");
  expect(requests.every((request) => request.init?.redirect === "error")).toBe(
    true,
  );
  expect(await registry.resolve(machine.id)).toEqual({
    url: "https://worker.example",
    token: registration.token,
  });
});

test("duplicate URLs, daemon identities and local aliases cannot be registered", async () => {
  const { registry, states, remoteId, localId } = await fixture();
  await registry.register(registration);
  await expect(registry.register(registration)).rejects.toThrow(
    "already registered",
  );
  states.set("https://alias.example", {
    id: remoteId,
    token: registration.token,
  });
  await expect(
    registry.register({ ...registration, url: "https://alias.example" }),
  ).rejects.toThrow("already registered");
  states.set("https://local.example", {
    id: localId,
    token: registration.token,
  });
  await expect(
    registry.register({ ...registration, url: "https://local.example" }),
  ).rejects.toThrow("already available locally");
});

test("identity changes and offline machines never fall back to local or send work", async () => {
  const { registry, states } = await fixture();
  const machine = await registry.register(registration);
  states.set("https://worker.example", {
    id: randomUUID(),
    token: registration.token,
  });
  await expect(registry.resolve(machine.id)).rejects.toThrow(
    "different machine",
  );
  expect((await registry.list()).machines[1].status).toBe("offline");
  states.delete("https://worker.example");
  await expect(registry.resolve(machine.id)).rejects.toThrow("Cannot reach");
  await expect(registry.resolve(randomUUID())).rejects.toThrow(
    "no longer registered",
  );
});

test("import identity and reconnect credentials are verified before replacing a connection", async () => {
  const { registry, remoteId, states } = await fixture();
  await expect(
    registry.register({ ...registration, machineId: randomUUID() }),
  ).rejects.toThrow("different machine");
  const machine = await registry.register(registration);
  const nextToken = "replacement-secret-token";
  states.set("https://new.example", { id: randomUUID(), token: nextToken });
  await expect(
    registry.update(machine.id, {
      action: "reconnect",
      url: "https://new.example",
      token: nextToken,
    }),
  ).rejects.toThrow("different machine");
  expect((await registry.resolve(machine.id)).token).toBe(registration.token);
  states.set("https://new.example", { id: remoteId, token: nextToken });
  await registry.update(machine.id, {
    action: "reconnect",
    url: "https://new.example",
    token: nextToken,
  });
  expect(await registry.resolve(machine.id)).toEqual({
    url: "https://new.example",
    token: nextToken,
  });
  await registry.update(machine.id, { action: "rename", name: "Mac mini" });
  expect((await registry.list()).machines[1].name).toBe("Mac mini");
  await registry.update(machine.id, { action: "remove" });
  await expect(registry.resolve(machine.id)).rejects.toThrow(
    "no longer registered",
  );
  expect(states.get("https://new.example")?.id).toBe(remoteId);
});

test("simultaneous registration keeps both records", async () => {
  const { registry, states } = await fixture();
  states.set("https://second.example", {
    id: randomUUID(),
    token: registration.token,
  });
  await Promise.all([
    registry.register(registration),
    registry.register({
      ...registration,
      name: "Second",
      url: "https://second.example",
    }),
  ]);
  expect((await registry.list()).machines).toHaveLength(3);
});
