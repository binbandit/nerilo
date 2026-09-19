import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  daemonIdentitySchema,
  machineRegistrationSchema,
  machineUpdateSchema,
  type Machine,
} from "@nerilo/protocol";

const recordSchema = machineRegistrationSchema.extend({
  id: daemonIdentitySchema.shape.id,
  daemonId: daemonIdentitySchema.shape.id,
  platform: daemonIdentitySchema.shape.platform,
});
const recordsSchema = recordSchema.array().max(32);
type MachineRecord = ReturnType<typeof recordSchema.parse>;
type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

export class MachineError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export function machineUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MachineError("Enter a valid machine URL.");
  }
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new MachineError(
      "Use HTTPS, or an HTTP localhost address through an SSH tunnel.",
    );
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new MachineError(
      "Use the machine's base URL without a path, credentials, or query.",
    );
  return url.origin;
}

// Next serves these operations in one process. Serialize read-modify-write operations.
const writes = new Map<string, Promise<unknown>>();
export class MachineRegistry {
  private readonly file: string;
  constructor(
    private readonly dataDir: string,
    private readonly local: { url: string; token: string },
    private readonly fetcher: Fetcher = fetch,
  ) {
    this.file = join(dataDir, "machines.json");
  }

  private async records() {
    try {
      return recordsSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return [];
      throw new MachineError("The saved machine list could not be read.", 500);
    }
  }

  private async save(records: MachineRecord[]) {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(records), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, this.file);
      await chmod(this.file, 0o600);
    } finally {
      await rm(temp, { force: true });
    }
  }

  private async change<T>(operation: () => Promise<T>): Promise<T> {
    const before = writes.get(this.file) ?? Promise.resolve();
    const next = before.catch(() => undefined).then(operation);
    writes.set(this.file, next);
    try {
      return await next;
    } finally {
      if (writes.get(this.file) === next) writes.delete(this.file);
    }
  }

  private async identity(
    target: { url: string; token: string },
    expected?: string,
  ) {
    try {
      const response = await this.fetcher(`${target.url}/machine`, {
        headers: { Authorization: `Bearer ${target.token}` },
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(4000),
      });
      if (response.status === 401 || response.status === 403)
        throw new MachineError(
          "The machine rejected its connection token. Update the connection.",
          503,
        );
      if (!response.ok)
        throw new MachineError(
          "The machine did not respond. Check its daemon and connection, then retry.",
          503,
        );
      const result = daemonIdentitySchema.safeParse(await response.json());
      if (!result.success)
        throw new MachineError(
          "This daemon needs an update before it can connect to Nerilo.",
          503,
        );
      if (expected && result.data.id !== expected)
        throw new MachineError(
          "This address now belongs to a different machine. Remove this connection and register it again.",
          409,
        );
      return result.data;
    } catch (error) {
      if (error instanceof MachineError) throw error;
      throw new MachineError(
        "Cannot reach this machine. Check its daemon and connection, then retry.",
        503,
      );
    }
  }

  private async localId() {
    try {
      return daemonIdentitySchema.shape.id.parse(
        (await readFile(join(this.dataDir, "machine-id"), "utf8")).trim(),
      );
    } catch {
      return null;
    }
  }

  private async publicMachine(record: MachineRecord): Promise<Machine> {
    const base = {
      id: record.id,
      name: record.name,
      url: record.url,
      daemonId: record.daemonId,
      platform: record.platform,
    };
    try {
      const identity = await this.identity(record, record.daemonId);
      return {
        ...base,
        platform: identity.platform,
        status: "online",
        error: null,
      };
    } catch (error) {
      return {
        ...base,
        status: "offline",
        error:
          error instanceof MachineError
            ? error.message
            : "Cannot reach this machine.",
      };
    }
  }

  async list(): Promise<{ machines: Machine[] }> {
    const records = await this.records();
    const local: Machine = {
      id: "local",
      name: "This machine",
      url: this.local.url,
      daemonId: await this.localId(),
      platform: null,
      status: "offline",
      error: null,
    };
    const localCheck = async () => {
      try {
        const identity = await this.identity(
          this.local,
          local.daemonId ?? undefined,
        );
        return {
          ...local,
          daemonId: identity.id,
          platform: identity.platform,
          status: "online" as const,
        };
      } catch (error) {
        return {
          ...local,
          error:
            error instanceof MachineError
              ? error.message
              : "Cannot reach this machine.",
        };
      }
    };
    return {
      machines: await Promise.all([
        localCheck(),
        ...records.map((record) => this.publicMachine(record)),
      ]),
    };
  }

  async register(value: unknown) {
    const parsed = machineRegistrationSchema.safeParse(value);
    if (!parsed.success)
      throw new MachineError(
        "Check the machine name, URL, and connection token.",
      );
    const input = parsed.data;
    const target = { ...input, url: machineUrl(input.url) };
    const identity = await this.identity(target, input.machineId);
    return this.change(async () => {
      const records = await this.records();
      if (
        identity.id === (await this.localId()) ||
        target.url === this.local.url
      )
        throw new MachineError(
          "This machine is already available locally.",
          409,
        );
      if (
        records.some(
          (record) =>
            record.daemonId === identity.id || record.url === target.url,
        )
      )
        throw new MachineError("This machine is already registered.", 409);
      if (records.length >= 32)
        throw new MachineError("You can register up to 32 machines.");
      const record = {
        ...target,
        id: randomUUID(),
        daemonId: identity.id,
        platform: identity.platform,
      };
      await this.save([...records, record]);
      return {
        id: record.id,
        name: record.name,
        url: record.url,
        daemonId: record.daemonId,
        platform: record.platform,
        status: "online" as const,
        error: null,
      };
    });
  }

  async update(id: string, value: unknown) {
    const parsed = machineUpdateSchema.safeParse(value);
    if (!parsed.success)
      throw new MachineError(
        "Check the machine name, URL, and connection token.",
      );
    const input = parsed.data;
    return this.change(async () => {
      const records = await this.records();
      const record = records.find((item) => item.id === id);
      if (!record)
        throw new MachineError("This machine is no longer registered.", 404);
      if (input.action === "remove") {
        await this.save(records.filter((item) => item.id !== id));
        return { ok: true };
      }
      if (input.action === "rename") {
        record.name = input.name;
        await this.save(records);
        return { ok: true };
      }
      if (input.machineId && input.machineId !== record.daemonId)
        throw new MachineError(
          "This connection file belongs to a different machine.",
          409,
        );
      const target = { url: machineUrl(input.url), token: input.token };
      if (records.some((item) => item.id !== id && item.url === target.url))
        throw new MachineError("This address is already registered.", 409);
      const identity = await this.identity(target, record.daemonId);
      Object.assign(record, target, { platform: identity.platform });
      await this.save(records);
      return {
        id: record.id,
        name: record.name,
        url: record.url,
        daemonId: record.daemonId,
        platform: record.platform,
        status: "online" as const,
        error: null,
      };
    });
  }

  async resolve(id: string | null) {
    if (!id || id === "local") return this.local;
    const record = (await this.records()).find((item) => item.id === id);
    if (!record)
      throw new MachineError(
        "This machine is no longer registered. Choose another machine.",
        404,
      );
    await this.identity(record, record.daemonId);
    return { url: record.url, token: record.token };
  }
}
