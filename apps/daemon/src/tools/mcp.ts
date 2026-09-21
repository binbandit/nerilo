import {
  mcpServersSchema,
  type Settings,
  type Sandbox,
} from "@nerilo/protocol";
import type { Store } from "../platform/store";

export function saveMcpServers(store: Store, input: unknown) {
  const servers = mcpServersSchema.parse(input);
  const previous = store.get("settings", "default")!;
  store.put("settings", "default", { ...previous, mcpServers: servers });
  store.event({
    taskId: null,
    turnId: null,
    kind: "system",
    text: "MCP servers updated. Changes apply to the next agent turn.",
  });
  return servers;
}

export function taskMcpServers(settings: Settings, sandbox: Sandbox) {
  const servers = settings.mcpServers.filter((server) => server.enabled);
  if (
    sandbox.network === "provider-only" &&
    servers.some((server) => server.transport === "http")
  )
    throw new Error(
      "HTTP MCP servers need Internet access. Change this task’s sandbox network access or disable those servers in Settings.",
    );
  return servers;
}
