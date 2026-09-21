import { mkdirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { readPrivateFile } from "./private-file";

const machineId = z.uuid();

export function readMachineIdentity(
  directory: string,
  name = process.env.NERILO_MACHINE_NAME?.trim() || hostname(),
) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const result = machineId.safeParse(
    readPrivateFile(
      join(directory, "machine-id"),
      () => `${crypto.randomUUID()}\n`,
    ).trim(),
  );
  if (!result.success)
    throw new Error(
      "The stored machine identity is invalid. Restore machine-id from a backup.",
    );
  return {
    id: result.data,
    name,
    platform: process.platform,
    protocolVersion: 1 as const,
  };
}
