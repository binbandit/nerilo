import { existsSync, readFileSync, rmSync } from "node:fs";
import { X509Certificate } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  gatewayEnvironment,
  gatewayInputSchema,
  gatewayViewSchema,
  type GatewayView,
  type Provider,
} from "@nerilo/protocol";
import { command, dataDir } from "../platform/config";
import { writePrivateFile } from "../platform/private-file";

const profileSchema = gatewayInputSchema.extend({ revision: z.string() });
const profilePath = (provider: Provider) =>
  join(dataDir, `${provider}-gateway.json`);
export function gatewayProfile(provider: Provider) {
  try {
    return profileSchema.parse(
      JSON.parse(readFileSync(profilePath(provider), "utf8")),
    );
  } catch {
    return null;
  }
}
export function gatewayView(provider: Provider): GatewayView | null {
  const profile = gatewayProfile(provider);
  if (!profile) return null;
  const { baseUrl, model, authHeader, env, credential, caCertificate } =
    profile;
  return gatewayViewSchema.parse({
    baseUrl,
    model,
    authHeader,
    env,
    credential: {
      type: credential.type,
      configured: true,
      ...(credential.type === "environment"
        ? { variable: credential.variable }
        : {}),
    },
    headerNames: [
      ...Object.keys(profile.headers ?? {}),
      ...Object.keys(profile.headerEnv ?? {}),
    ],
    hasCertificate: Boolean(caCertificate),
  });
}
export function saveGateway(provider: Provider, input: unknown) {
  const parsed = gatewayInputSchema.parse(input);
  const previous = gatewayProfile(provider);
  const changedHost =
    previous &&
    new URL(previous.baseUrl).origin !== new URL(parsed.baseUrl).origin;
  if (
    changedHost &&
    (parsed.headers === undefined || parsed.headerEnv === undefined) &&
    previous &&
    Object.keys({ ...previous.headers, ...previous.headerEnv }).length
  )
    throw new Error(
      "Re-enter custom headers when changing to a different gateway address.",
    );
  if (
    parsed.credential.type !== "environment" &&
    !parsed.credential.value?.trim()
  ) {
    if (changedHost || previous?.credential.type !== parsed.credential.type)
      throw new Error("Enter an API key or key helper.");
    parsed.credential = previous.credential;
  }
  const profile = profileSchema.parse({
    ...parsed,
    headers: parsed.headers ?? previous?.headers ?? {},
    headerEnv: parsed.headerEnv ?? previous?.headerEnv ?? {},
    caCertificate: parsed.caCertificate ?? previous?.caCertificate ?? "",
    revision: crypto.randomUUID(),
  });
  if (profile.caCertificate) {
    const certificates = profile.caCertificate.match(
      /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
    );
    try {
      if (
        !certificates?.length ||
        profile.caCertificate
          .replace(
            /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
            "",
          )
          .trim()
      )
        throw new Error();
      for (const certificate of certificates) new X509Certificate(certificate);
    } catch {
      throw new Error("Enter your company's certificate in PEM format.");
    }
  }
  const names = [
    ...Object.keys(profile.headers ?? {}),
    ...Object.keys(profile.headerEnv ?? {}),
    profile.authHeader,
  ].map((name) => name.toLowerCase());
  if (new Set(names).size !== names.length)
    throw new Error(
      "Each header can have only one source. Use Authentication for the API key header.",
    );
  writePrivateFile(profilePath(provider), JSON.stringify(profile));
  return gatewayView(provider)!;
}
export function removeGateway(provider: Provider) {
  rmSync(profilePath(provider), { force: true });
}

export async function gatewayCredentials(provider: Provider) {
  const profile = gatewayProfile(provider);
  if (!profile)
    throw new Error(
      "The gateway settings could not be read. Reconnect in Settings > Connections.",
    );
  const credential = profile.credential;
  let key: string | undefined;
  if (credential.type === "key") key = credential.value;
  else if (credential.type === "environment")
    key = process.env[credential.variable];
  else {
    // Only an explicitly saved, machine-level helper runs here, never project config.
    // Resolve it on the host so a Mac key manager does not need to exist in Docker.
    const result = await command(
      [process.env.SHELL || "/bin/sh", "-lc", credential.value!],
      {
        cwd: dataDir,
        timeout: 10000,
        outputTail: 8192,
      },
    ).catch(() => null);
    if (!result || result.code !== 0)
      throw new Error(
        "The gateway key helper failed or timed out. Check your key manager and reconnect.",
      );
    key = result.stdout.trim();
  }
  if (!key || !/^[\x21-\x7e]{1,8192}$/.test(key))
    throw new Error(
      credential.type === "environment"
        ? `The gateway key variable ${credential.variable} is missing or invalid on this machine. Restart Nerilo after setting it.`
        : "The gateway key is empty or invalid. Check your key manager or connection settings.",
    );
  const headers = { ...profile.headers };
  for (const [name, variable] of Object.entries(profile.headerEnv ?? {})) {
    const value = process.env[variable];
    if (!value || /[\r\n\x00-\x1f\x7f]/.test(value))
      throw new Error(
        `The gateway header variable ${variable} is missing or invalid on this machine.`,
      );
    headers[name] = value;
  }
  return {
    baseUrl: profile.baseUrl,
    model: profile.model,
    authHeader: profile.authHeader,
    key,
    headers,
    env: profile.env,
    caCertificate: profile.caCertificate,
    revision: profile.revision,
  };
}

const settingsPath = (provider: Provider) =>
  provider === "claude"
    ? join(
        process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), ".claude"),
        "settings.json",
      )
    : join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "config.toml");
const record = z.record(z.string(), z.unknown());
const strings = z.record(z.string(), z.string());
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export function importedGateway(provider: Provider) {
  let raw: Record<string, unknown>;
  try {
    const text = readFileSync(settingsPath(provider), "utf8");
    raw = record.parse(
      provider === "claude" ? JSON.parse(text) : Bun.TOML.parse(text),
    );
  } catch {
    throw new Error(
      "The agent settings file could not be read. Enter your gateway details manually.",
    );
  }
  if (provider === "claude") {
    const env = strings.parse(raw.env ?? {});
    const headers = Object.fromEntries(
      (env.ANTHROPIC_CUSTOM_HEADERS ?? "")
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => {
          const colon = line.indexOf(":");
          if (colon < 1)
            throw new Error("The agent's custom headers are invalid.");
          return [line.slice(0, colon).trim(), line.slice(colon + 1).trim()];
        }),
    );
    const helper = z.string().optional().parse(raw.apiKeyHelper);
    const key = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY;
    return gatewayInputSchema.parse({
      baseUrl: env.ANTHROPIC_BASE_URL,
      model: env.ANTHROPIC_MODEL || raw.model || "opus",
      authHeader: env.ANTHROPIC_AUTH_TOKEN ? "authorization" : "x-api-key",
      credential: key
        ? { type: "key", value: key }
        : helper
          ? { type: "command", value: helper }
          : { type: "environment", variable: "AI_GATEWAY_API_KEY" },
      headers,
      headerEnv: {},
      env: Object.fromEntries(
        Object.entries(env).filter(([key]) => gatewayEnvironment.test(key)),
      ),
      caCertificate: "",
    });
  }
  const selectedProfile =
    typeof raw.profile === "string"
      ? record.parse(record.parse(raw.profiles ?? {})[raw.profile] ?? {})
      : {};
  const effective = { ...raw, ...selectedProfile };
  const selected = z.string().parse(effective.model_provider);
  const providerConfig = record.parse(
    record.parse(raw.model_providers ?? {})[selected],
  );
  if (providerConfig.wire_api && providerConfig.wire_api !== "responses")
    throw new Error(
      "This gateway must support the OpenAI Responses API for Codex.",
    );
  const auth = providerConfig.auth
    ? z
        .object({ command: z.string(), args: z.array(z.string()).default([]) })
        .parse(providerConfig.auth)
    : null;
  return gatewayInputSchema.parse({
    baseUrl: providerConfig.base_url,
    model: effective.model,
    credential: auth
      ? {
          type: "command",
          value: [auth.command, ...auth.args].map(quote).join(" "),
        }
      : providerConfig.experimental_bearer_token
        ? { type: "key", value: providerConfig.experimental_bearer_token }
        : {
            type: "environment",
            variable: providerConfig.env_key ?? "AI_GATEWAY_API_KEY",
          },
    headers: strings.parse(providerConfig.http_headers ?? {}),
    headerEnv: strings.parse(providerConfig.env_http_headers ?? {}),
    env: {},
    caCertificate: "",
  });
}
export function canImportGateway(provider: Provider) {
  if (!existsSync(settingsPath(provider))) return false;
  try {
    importedGateway(provider);
    return true;
  } catch {
    return false;
  }
}
