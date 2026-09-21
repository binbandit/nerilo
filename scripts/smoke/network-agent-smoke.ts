import { command, imageTag } from "../../apps/daemon/src/platform/config";
import { credentials } from "../../apps/daemon/src/agents/credentials";
import {
  createProviderNetwork,
  cleanupProviderNetwork,
  providerNetworkArgs,
} from "../../apps/daemon/src/sandbox/sandbox-network";

const taskId = crypto.randomUUID();
const turnId = crypto.randomUUID();
const container = `nerilo-network-agent-proof-${turnId}`;
try {
  await createProviderNetwork(taskId, turnId, "codex", imageTag);
  const secret = await credentials("codex");
  const result = await command(
    [
      "docker",
      "run",
      "--rm",
      "-i",
      "--name",
      container,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      ...providerNetworkArgs(turnId),
      "--tmpfs",
      "/tmp:rw,nosuid,size=128m,mode=1777",
      "--tmpfs",
      "/home/node:rw,nosuid,size=128m,uid=1000,gid=1000",
      "--entrypoint",
      "node",
      imageTag,
      "/opt/nerilo/metadata.mjs",
    ],
    {
      input:
        JSON.stringify({
          ...secret,
          provider: "codex",
          model: "gpt-5.6-luna",
          instructions: "Return a JSON object with message exactly NETWORK_OK.",
          context: "A provider network connectivity test. Do not use tools.",
          schema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
            additionalProperties: false,
          },
        }) + "\n",
      timeout: 90000,
    },
  );
  if (result.code || JSON.parse(result.stdout).message !== "NETWORK_OK")
    throw new Error(
      "Live Codex request through provider-only network did not complete.",
    );
  console.log(
    "Live Codex login completed a model request through the enforced provider-only network.",
  );
} finally {
  await command(["docker", "rm", "-f", container]);
  await cleanupProviderNetwork(turnId);
}
