import "./test-setup";
import { command, imageTag } from "../apps/daemon/src/config";
import {
  createProviderNetwork,
  cleanupProviderNetwork,
  providerNetworkArgs,
} from "../apps/daemon/src/sandbox-network";

const taskId = crypto.randomUUID();
const turnId = crypto.randomUUID();
const client = `nerilo-network-proof-${turnId}`;
try {
  await createProviderNetwork(taskId, turnId, "codex", imageTag);
  const run = async (args: string[]) =>
    command(
      [
        "docker",
        "run",
        "--rm",
        "--name",
        client,
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        ...providerNetworkArgs(turnId),
        "--entrypoint",
        "curl",
        imageTag,
        ...args,
      ],
      { timeout: 15000 },
    );
  const allowed = await run([
    "--max-time",
    "10",
    "-sS",
    "-o",
    "/dev/null",
    "-w",
    "%{http_connect}",
    "https://api.openai.com",
  ]);
  if (allowed.code || allowed.stdout !== "200")
    throw new Error(`Provider request failed: ${allowed.stderr}`);
  for (const destination of [
    "https://example.com",
    "https://127.0.0.1",
    "https://169.254.169.254",
    "https://api.openai.com:444",
  ]) {
    const denied = await run([
      "--max-time",
      "5",
      "-sS",
      "-o",
      "/dev/null",
      "-w",
      "%{http_connect}",
      destination,
    ]);
    if (denied.code === 0 || denied.stdout !== "403")
      throw new Error(`Proxy allowed ${destination}`);
  }
  for (const destination of [
    "https://1.1.1.1",
    "http://192.168.65.254",
    "http://host.docker.internal:5185",
  ]) {
    const denied = await run([
      "--noproxy",
      "*",
      "--max-time",
      "3",
      "-sS",
      destination,
    ]);
    if (denied.code === 0)
      throw new Error(`Direct network bypass allowed ${destination}`);
  }
  console.log(
    "Provider TLS works; arbitrary proxies, private targets, direct Internet, and host access are blocked.",
  );
} finally {
  await command(["docker", "rm", "-f", client]);
  await cleanupProviderNetwork(turnId);
}
