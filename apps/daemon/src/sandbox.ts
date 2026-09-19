import { sandboxSchema, type Sandbox } from "@nerilo/protocol";
import { checked, command } from "./config";
import { providerNetworkArgs } from "./sandbox-network";

export function sandboxLimits(
  input: Omit<Sandbox, "network"> & Partial<Pick<Sandbox, "network">>,
) {
  const sandbox = sandboxSchema.parse(input);
  return [
    "--cpus",
    String(sandbox.cpus),
    "--memory",
    `${sandbox.memoryMB}m`,
    "--pids-limit",
    String(sandbox.pids),
  ];
}

export async function prepareReadOnlyWorkspace({
  container,
  taskId,
  turnId,
  image,
  sandbox,
}: {
  container: string;
  taskId: string;
  turnId: string;
  image: string;
  sandbox: Sandbox;
}) {
  await checked([
    "docker",
    "create",
    "--name",
    `${container}-bootstrap`,
    "--label",
    "dev.nerilo.managed=true",
    "--label",
    `dev.nerilo.task=${taskId}`,
    "--label",
    `dev.nerilo.turn=${turnId}`,
    "--interactive",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    ...sandboxLimits(sandbox),
    ...(sandbox.network === "provider-only" ? providerNetworkArgs(turnId) : []),
    "--tmpfs",
    "/tmp:rw,nosuid,size=1g,mode=1777",
    "--tmpfs",
    "/home/node:rw,nosuid,size=128m,uid=1000,gid=1000",
    "--mount",
    `type=volume,source=nerilo-work-${taskId},target=/work`,
    "--entrypoint",
    "node",
    image,
    "/opt/nerilo/bootstrap.mjs",
  ]);
}

export async function bootstrapReadOnly(
  container: string,
  input: { branch: string; setup: string },
  stopped: () => boolean,
) {
  const name = `${container}-bootstrap`;
  const cancel = setInterval(() => {
    if (stopped())
      void command(["docker", "rm", "-f", name], { timeout: 5000 }).catch(
        () => {},
      );
  }, 1000);
  try {
    const result = await command(
      ["docker", "start", "--attach", "--interactive", name],
      { input: JSON.stringify(input) + "\n", timeout: 300000 },
    );
    if (result.code)
      throw new Error(
        `Workspace preparation failed. ${(result.stderr || result.stdout).slice(-3000)}`,
      );
    return result.stdout.slice(-10000);
  } finally {
    clearInterval(cancel);
    await command(["docker", "rm", "-f", name], { timeout: 5000 }).catch(
      () => {},
    );
  }
}
