const defaults = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4",
  google: "gemini-2.5-pro",
  openrouter: "anthropic/claude-sonnet-4.6",
};
const variables = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};
export function harnessConnection(config) {
  if (config.gateway)
    throw new Error("Company gateways are not supported by this harness yet.");
  const keys = config.harnessKeys ?? {};
  const vendor = config.model
    ? config.model.split("/")[0]
    : Object.keys(defaults).find((name) => keys[name]);
  if (!defaults[vendor] || !keys[vendor])
    throw new Error(
      "Connect an API key for the selected model provider in Settings.",
    );
  const model = config.model || `${vendor}/${defaults[vendor]}`;
  const env = { [variables[vendor]]: keys[vendor] };
  if (config.provider === "opencode")
    Object.assign(env, {
      // Startup must work under the provider-only network policy, with no downloads.
      OPENCODE_DISABLE_MODELS_FETCH: "true",
      OPENCODE_DISABLE_AUTOUPDATE: "true",
      OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
      OPENCODE_DISABLE_PROJECT_CONFIG: "true",
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        autoupdate: false,
        share: "disabled",
        enabled_providers: [vendor],
        permission: config.metadata ? "deny" : "allow",
        skills: { paths: config.metadata ? [] : ["/tmp/nerilo-skills/skills"] },
        provider: {
          [vendor]: { options: { apiKey: `{env:${variables[vendor]}}` } },
        },
      }),
    });
  if (config.provider === "pi")
    Object.assign(env, { PI_OFFLINE: "1", PI_TELEMETRY: "0" });
  return { args: [], env, model };
}

export function harnessArguments(config, connection, skills = { args: [] }) {
  const { sessionId, effort, metadata } = config;
  if (config.provider === "opencode")
    return [
      "opencode",
      "run",
      "--format",
      "json",
      "--pure",
      ...(metadata ? [] : ["--auto"]),
      ...(sessionId ? ["--session", sessionId] : []),
      "--model",
      connection.model,
      ...(effort ? ["--variant", effort] : []),
    ];
  if (config.provider === "pi")
    return [
      "pi",
      "--print",
      "--mode",
      "json",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-approve",
      ...skills.args,
      ...(metadata ? ["--no-session", "--no-tools", "--no-context-files"] : []),
      ...(sessionId ? ["--session", sessionId] : []),
      "--model",
      connection.model,
      ...(effort ? ["--thinking", effort === "none" ? "off" : effort] : []),
    ];
  throw new Error("Unknown harness");
}
