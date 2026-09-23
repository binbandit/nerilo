import { writeFile, rm } from "node:fs/promises";

export const MCP_CODEX_PATH = "/tmp/nerilo-codex-mcp.toml";
export const MCP_OPENCODE_PATH = "/tmp/nerilo-opencode.json";
export const MCP_CLAUDE_PATH = "/tmp/nerilo-mcp.json";

// Quote every key and value. Server input must never become TOML syntax.
export function toml(value) {
  if (typeof value === "string")
    return JSON.stringify(value).replace(/\u007f/g, "\\u007f");
  if (typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.map(toml).join(", ")}]`;
  return `{ ${Object.entries(value)
    .map(([key, entry]) => `${toml(key)} = ${toml(entry)}`)
    .join(", ")} }`;
}

export function mcpConfigs(servers = []) {
  const enabled = servers.filter((server) => server.enabled);
  const codex = Object.fromEntries(
    enabled.map((server) => [
      server.id,
      server.transport === "stdio"
        ? {
            command: server.command,
            args: server.args ?? [],
            env: server.env ?? {},
            cwd: "/work/repo",
          }
        : { url: server.url, http_headers: server.headers ?? {} },
    ]),
  );
  const env = {};
  let variable = 0;
  // Claude expands ${...} in config strings. One indirection preserves literal
  // user values, including tokens containing that syntax, without CLI arguments.
  const literal = (value) => {
    const key = `NERILO_MCP_VALUE_${variable++}`;
    env[key] = value;
    return `\${${key}}`;
  };
  const literals = (values) =>
    Object.fromEntries(
      Object.entries(values ?? {}).map(([key, value]) => [key, literal(value)]),
    );
  const claude = Object.fromEntries(
    enabled.map((server) => [
      server.id,
      server.transport === "stdio"
        ? {
            type: "stdio",
            command: literal(server.command),
            args: (server.args ?? []).map(literal),
            env: literals(server.env),
          }
        : {
            type: "http",
            url: literal(server.url),
            headers: literals(server.headers),
          },
    ]),
  );
  return {
    codex: `mcp_servers = ${toml(codex)}\n`,
    claude: JSON.stringify({ mcpServers: claude }),
    claudeEnv: env,
  };
}

// Short values such as "1" or "production" also occur in unrelated output, and
// redacting them corrupts diffs. Generated credentials are longer than this.
const MIN_SECRET_LENGTH = 8;
const SECRET_NAME =
  /key|token|secret|pass|pwd|auth|credential|cookie|session|signature|^sig$|private/i;
const SCHEME = /^(?:Bearer|Basic|Token)\s+(.+)$/i;

// Values under unremarkable names are kept when they resemble generated
// credentials: long, unbroken, and mixing letters with digits.
const looksSecret = (value) =>
  value.length >= 16 &&
  !/\s/.test(value) &&
  /[a-z]/i.test(value) &&
  /\d/.test(value);

const decoded = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

// Credentials carried by a URL: userinfo and secret query values. The whole URL
// is redacted too when it carries any, so short parameters are still covered.
function urlSecrets(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return [];
  }
  const secrets = [];
  for (const part of [url.username, url.password])
    if (part) secrets.push(part, decoded(part));
  for (const parameter of url.search.slice(1).split("&")) {
    const separator = parameter.indexOf("=");
    if (separator < 0) continue;
    const [[name, text]] = new URLSearchParams(parameter);
    if (!SECRET_NAME.test(name) && !looksSecret(text)) continue;
    secrets.push(
      parameter.slice(separator + 1),
      text,
      encodeURIComponent(text),
    );
  }
  return secrets.length ? [value, ...secrets] : [];
}

/** Values of named settings (environment, headers) that may be credentials. */
export function settingRedactions(settings = {}) {
  const secrets = [];
  for (const [name, value] of Object.entries(settings ?? {})) {
    if (typeof value !== "string") continue;
    const url = /^[a-z][a-z\d+.-]*:\/\//i.test(value) ? urlSecrets(value) : [];
    // Providers can report an Authorization token without its scheme.
    const scheme = SCHEME.exec(value);
    if (SECRET_NAME.test(name) || scheme)
      secrets.push(value, ...(scheme ? [scheme[1]] : []), ...url);
    else if (url.length) secrets.push(...url);
    else if (looksSecret(value)) secrets.push(value);
  }
  return secrets.filter((value) => value.length >= MIN_SECRET_LENGTH);
}

export function mcpRedactions(servers = []) {
  const secrets = [];
  for (const server of servers) {
    secrets.push(
      ...settingRedactions(server.env),
      ...settingRedactions(server.headers),
    );
    if (server.url)
      secrets.push(
        ...urlSecrets(server.url).filter(
          (value) => value.length >= MIN_SECRET_LENGTH,
        ),
      );
  }
  return secrets;
}

export function agentRedactions(config) {
  return redactionVariants([
    config.apiKey,
    ...Object.values(config.harnessKeys ?? {}),
    config.codexAuth?.OPENAI_API_KEY,
    ...Object.values(config.codexAuth?.tokens ?? {}),
    ...mcpRedactions(config.mcpServers),
    config.gateway?.key,
    ...settingRedactions(config.gateway?.headers),
  ]);
}

export function redactionVariants(values) {
  return [
    ...new Set(
      values
        .filter((value) => typeof value === "string" && value)
        .flatMap((value) => [value, JSON.stringify(value).slice(1, -1)]),
    ),
  ].sort((a, b) => b.length - a.length);
}

export function redactOutput(value, redactions, preservedKeys = new Set()) {
  if (typeof value === "string")
    return redactions.reduce(
      (text, secret) =>
        text
          .split("[redacted]")
          .map((part) => part.split(secret).join("[redacted]"))
          .join("[redacted]"),
      value,
    );
  if (Array.isArray(value))
    return value.map((entry) => redactOutput(entry, redactions, preservedKeys));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        preservedKeys.has(key)
          ? entry
          : redactOutput(entry, redactions, preservedKeys),
      ]),
    );
  return value;
}

export async function clearMcpConfig(
  paths = [MCP_CODEX_PATH, MCP_CLAUDE_PATH, MCP_OPENCODE_PATH],
) {
  await Promise.all(paths.map((path) => rm(path, { force: true })));
}

export async function prepareMcpConfig(provider, servers = []) {
  await clearMcpConfig();
  if (provider === "pi") {
    if (servers.some((server) => server.enabled))
      throw new Error(
        "Pi does not support MCP servers. Deselect MCP servers in this task’s tools to continue.",
      );
    return { args: [], env: {} };
  }
  if (provider === "opencode") {
    const mcp = Object.fromEntries(
      servers
        .filter((server) => server.enabled)
        .map((server) => [
          server.id,
          server.transport === "stdio"
            ? {
                type: "local",
                command: [server.command, ...(server.args ?? [])],
                environment: server.env ?? {},
                enabled: true,
              }
            : {
                type: "remote",
                url: server.url,
                headers: server.headers ?? {},
                oauth: false,
                enabled: true,
              },
        ]),
    );
    // OpenCode expands {env:...} and {file:...}; reject interpolation in supplied values.
    if (/\{(?:env|file):/.test(JSON.stringify(mcp)))
      throw new Error(
        "OpenCode MCP settings cannot contain environment or file interpolation.",
      );
    await writeFile(MCP_OPENCODE_PATH, JSON.stringify({ mcp }), {
      mode: 0o600,
      flag: "wx",
    });
    return { args: [], env: { OPENCODE_CONFIG: MCP_OPENCODE_PATH } };
  }
  const config = mcpConfigs(servers);
  if (provider === "codex") {
    await writeFile(MCP_CODEX_PATH, config.codex, { mode: 0o600, flag: "wx" });
    return { args: [], env: {} };
  }
  await writeFile(MCP_CLAUDE_PATH, config.claude, { mode: 0o600, flag: "wx" });
  return { args: ["--mcp-config", MCP_CLAUDE_PATH], env: config.claudeEnv };
}
