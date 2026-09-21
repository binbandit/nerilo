import { harnessConnection } from "./harnesses.mjs";
import { writeFile, rm } from "node:fs/promises";
import { toml } from "./mcp.mjs";

const certificatePath = "/tmp/nerilo-gateway-ca.pem";
export function agentConnection(config) {
  if (["opencode", "pi"].includes(config.provider))
    return harnessConnection(config);
  const gateway = config.gateway;
  const env = {
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    DISABLE_TELEMETRY: "true",
    ENABLE_CLAUDEAI_MCP_SERVERS: "false",
  };
  if (!gateway) {
    if (config.apiKey)
      env[config.provider === "codex" ? "CODEX_API_KEY" : "ANTHROPIC_API_KEY"] =
        config.apiKey;
    return { args: [], env, model: config.model };
  }
  if (gateway.caCertificate)
    Object.assign(env, {
      NODE_EXTRA_CA_CERTS: certificatePath,
      CODEX_CA_CERTIFICATE: certificatePath,
    });
  if (config.provider === "claude") {
    Object.assign(env, gateway.env, {
      ANTHROPIC_BASE_URL: gateway.baseUrl,
      [gateway.authHeader === "x-api-key"
        ? "ANTHROPIC_API_KEY"
        : "ANTHROPIC_AUTH_TOKEN"]: gateway.key,
      ANTHROPIC_CUSTOM_HEADERS: Object.entries(gateway.headers)
        .map(([name, value]) => `${name}: ${value}`)
        .join("\n"),
    });
    return { args: [], env, model: config.model || gateway.model };
  }
  const headers = {
    ...gateway.headers,
    [gateway.authHeader]:
      gateway.authHeader === "authorization"
        ? `Bearer ${gateway.key}`
        : gateway.key,
  };
  const envHeaders = {};
  for (const [index, [name, value]] of Object.entries(headers).entries()) {
    const variable = `NERILO_GATEWAY_HEADER_${index}`;
    env[variable] = value;
    envHeaders[name] = variable;
  }
  return {
    // Configuration values, including header *names*, are TOML-quoted. Secrets
    // travel in the child environment and are never placed in process arguments.
    args: [
      "-c",
      'model_provider="nerilo_gateway"',
      "-c",
      `model_providers.nerilo_gateway=${toml({
        name: "Company gateway",
        base_url: gateway.baseUrl,
        wire_api: "responses",
        env_http_headers: envHeaders,
      })}`,
      "-c",
      'web_search="disabled"',
      "-c",
      "analytics.enabled=false",
    ],
    env,
    model: config.model || gateway.model,
  };
}
export async function prepareConnection(config) {
  await clearConnection();
  if (config.gateway?.caCertificate)
    await writeFile(certificatePath, config.gateway.caCertificate, {
      mode: 0o600,
      flag: "wx",
    });
  return agentConnection(config);
}
export async function clearConnection() {
  await rm(certificatePath, { force: true });
}
