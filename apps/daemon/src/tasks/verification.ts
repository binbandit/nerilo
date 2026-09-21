import { z } from "zod";
import { resultSchema, sandboxDefaults, type Turn } from "@nerilo/protocol";
import { checked, command } from "../platform/config";
import { sandboxLimits } from "../sandbox/sandbox";
import { providerNetworkArgs } from "../sandbox/sandbox-network";

const stateSchema = z.object({
  Status: z.string(),
  Running: z.boolean(),
  ExitCode: z.number(),
});
export const verificationResultSchema = resultSchema.pick({
  verification: true,
  diff: true,
  changes: true,
  headCommit: true,
  truncated: true,
});
export async function reconcileVerification(turn: Turn) {
  const job = turn.check;
  if (!job || !turn.result) throw new Error("Verification context is missing.");
  const sandbox = turn.sandbox ?? sandboxDefaults;
  let inspected = await command(
    ["docker", "inspect", "--format", "{{json .State}}", job.container],
    { timeout: 5000 },
  );
  if (inspected.code) {
    await checked([
      "docker",
      "create",
      "--name",
      job.container,
      "--label",
      "dev.nerilo.managed=true",
      "--label",
      `dev.nerilo.task=${turn.taskId}`,
      "--label",
      `dev.nerilo.turn=${turn.id}`,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      ...sandboxLimits(sandbox),
      ...(sandbox.network === "provider-only"
        ? providerNetworkArgs(turn.id)
        : []),
      "--tmpfs",
      "/tmp:rw,nosuid,size=1g,mode=1777",
      "--tmpfs",
      "/home/node:rw,nosuid,size=128m,uid=1000,gid=1000",
      "--mount",
      `type=volume,source=nerilo-work-${turn.taskId},target=/work${sandbox.workspace === "read-only" ? ",readonly" : ""}`,
      "--entrypoint",
      "node",
      job.image,
      "/opt/nerilo/verify.mjs",
      job.command,
      turn.result.baseCommit,
      String(sandbox.workspace === "read-only"),
    ]);
    inspected = await command(
      ["docker", "inspect", "--format", "{{json .State}}", job.container],
      { timeout: 5000 },
    );
  }
  const state = stateSchema.parse(JSON.parse(inspected.stdout));
  if (state.Status === "created") {
    await checked(["docker", "start", job.container]);
    return null;
  }
  if (state.Running) return null;
  if (state.ExitCode !== 0)
    throw new Error(
      "The verification container stopped unexpectedly. Retry the task.",
    );
  const output = await checked(["docker", "logs", job.container]);
  return verificationResultSchema.parse(
    JSON.parse(output.trim().split("\n").at(-1) ?? ""),
  );
}
