import type { Provider } from "@nerilo/protocol";
import { checked, command } from "../platform/config";

export const networkNames = (turnId: string) => ({
  network: `nerilo-net-${turnId}`,
  proxy: `nerilo-egress-${turnId}`,
});
export function providerNetworkArgs(turnId: string) {
  const { network } = networkNames(turnId);
  return [
    "--network",
    network,
    "--dns",
    "127.0.0.1",
    ...[
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
    ].flatMap((key) => ["--env", `${key}=http://nerilo-egress:8080`]),
    "--env",
    "NO_PROXY=",
    "--env",
    "no_proxy=",
    "--env",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
    "--env",
    "ENABLE_CLAUDEAI_MCP_SERVERS=false",
  ];
}
export async function createProviderNetwork(
  taskId: string,
  turnId: string,
  provider: Provider,
  image: string,
  gatewayUrl?: string,
) {
  const { network, proxy } = networkNames(turnId);
  const labels = [
    "--label",
    "dev.nerilo.managed=true",
    "--label",
    `dev.nerilo.task=${taskId}`,
  ];
  try {
    await checked([
      "docker",
      "network",
      "create",
      ...labels,
      "--internal",
      "--opt",
      "com.docker.network.bridge.gateway_mode_ipv4=isolated",
      network,
    ]);
    await checked([
      "docker",
      "create",
      "--name",
      proxy,
      ...labels,
      "--network",
      "bridge",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--cpus",
      "0.5",
      "--memory",
      "128m",
      "--pids-limit",
      "64",
      "--env",
      `NERILO_PROVIDER=${provider}`,
      ...(gatewayUrl ? ["--env", `NERILO_GATEWAY_URL=${gatewayUrl}`] : []),
      "--entrypoint",
      "node",
      image,
      "/opt/nerilo/egress.mjs",
    ]);
    await checked([
      "docker",
      "network",
      "connect",
      "--alias",
      "nerilo-egress",
      network,
      proxy,
    ]);
    await checked(["docker", "start", proxy]);
  } catch (error) {
    await cleanupProviderNetwork(turnId);
    throw error;
  }
}
export async function cleanupProviderNetwork(turnId: string) {
  const { network, proxy } = networkNames(turnId);
  await command(["docker", "rm", "-f", proxy], { timeout: 5000 }).catch(
    () => {},
  );
  const attached = await command(
    [
      "docker",
      "network",
      "inspect",
      "--format",
      "{{range .Containers}}{{.Name}} {{end}}",
      network,
    ],
    { timeout: 5000 },
  ).catch(() => null);
  if (attached?.code === 0) {
    for (const name of attached.stdout.trim().split(/\s+/).filter(Boolean))
      await command(["docker", "network", "disconnect", "-f", network, name], {
        timeout: 5000,
      });
    await command(["docker", "network", "rm", network], { timeout: 5000 });
  }
}
