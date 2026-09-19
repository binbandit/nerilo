import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Provider } from "@nerilo/protocol";
import { z } from "zod";
import { checked, command, dataDir } from "./config";
import { claudeNativeStatus, disconnectClaudeLogin } from "./claude-login";
import { writePrivateFile } from "./private-file";
import {
  canImportGateway,
  gatewayCredentials,
  gatewayProfile,
  removeGateway,
} from "./gateway";
import {
  canImportClaude,
  importLocalClaude,
  removeImportedClaude,
} from "./claude-import";

const service = "dev.nerilo.agents";
const authPath = join(dataDir, "codex-auth.json");
const codexAuthSchema = z
  .looseObject({
    OPENAI_API_KEY: z.string().nullish(),
    tokens: z.looseObject({ access_token: z.string() }).nullish(),
  })
  .refine((auth) =>
    Boolean(auth.OPENAI_API_KEY?.trim() || auth.tokens?.access_token.trim()),
  );
function importedCodexAuth() {
  try {
    const result = codexAuthSchema.safeParse(
      JSON.parse(readFileSync(authPath, "utf8")),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
const sourcePath = join(
  process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  "auth.json",
);
const secrets = new Map<Provider, string>();
const modesPath = join(dataDir, "connection-modes.json");
type ConnectionMode =
  "key" | "imported" | "native" | "disconnected" | "gateway";
function mode(provider: Provider): ConnectionMode | undefined {
  if (!existsSync(modesPath)) return undefined;
  return (
    JSON.parse(readFileSync(modesPath, "utf8")) as Partial<
      Record<Provider, ConnectionMode>
    >
  )[provider];
}
function setMode(provider: Provider, value: ConnectionMode) {
  const modes = existsSync(modesPath)
    ? (JSON.parse(readFileSync(modesPath, "utf8")) as Partial<
        Record<Provider, ConnectionMode>
      >)
    : {};
  modes[provider] = value;
  writePrivateFile(modesPath, JSON.stringify(modes));
}
export function canImport() {
  return existsSync(sourcePath);
}
export async function apiKey(provider: Provider) {
  const selected = mode(provider);
  if (
    selected === "imported" ||
    selected === "native" ||
    selected === "gateway" ||
    selected === "disconnected"
  )
    return null;
  const env =
    provider === "codex"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY;
  if (env && selected !== "key") return env;
  if (secrets.has(provider)) return secrets.get(provider)!;
  if (process.platform === "darwin") {
    const r = await command([
      "security",
      "find-generic-password",
      "-s",
      service,
      "-a",
      provider,
      "-w",
    ]);
    if (r.code === 0) {
      secrets.set(provider, r.stdout.trim());
      return r.stdout.trim();
    }
  }
  return null;
}
export async function saveKey(provider: Provider, key: string) {
  if (process.platform !== "darwin")
    throw new Error(
      "Set the provider API key in the daemon environment on this platform.",
    );
  if (!/^[\x21-\x7E]{10,4096}$/.test(key))
    throw new Error("Enter a valid API key.");
  const quoted = key.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  await checked(["security", "-i"], {
    input: `add-generic-password -U -s "${service}" -a "${provider}" -w "${quoted}"\n`,
  });
  secrets.set(provider, key);
  setMode(provider, "key");
}
export function importCodex() {
  if (!canImport())
    throw new Error(
      "No file-based Codex login was found. Use an API key instead.",
    );
  const auth = codexAuthSchema.safeParse(
    JSON.parse(readFileSync(sourcePath, "utf8")),
  );
  if (!auth.success) throw new Error("The local Codex login is invalid.");
  writePrivateFile(authPath, JSON.stringify(auth.data));
  setMode("codex", "imported");
}
export async function disconnect(provider: Provider) {
  const selected = mode(provider);
  if (provider === "claude" && mode(provider) === "imported")
    await removeImportedClaude();
  if (provider === "claude" && mode(provider) === "native")
    await disconnectClaudeLogin();
  secrets.delete(provider);
  setMode(provider, "disconnected");
  if (provider === "codex" && existsSync(authPath)) unlinkSync(authPath);
  removeGateway(provider);
  if (process.platform === "darwin" && selected !== "gateway")
    await command([
      "security",
      "delete-generic-password",
      "-s",
      service,
      "-a",
      provider,
    ]);
}
export function selectClaudeLogin() {
  setMode("claude", "native");
}
export function selectGateway(provider: Provider) {
  setMode(provider, "gateway");
}
export function activeGateway(provider: Provider) {
  return mode(provider) === "gateway" ? gatewayProfile(provider) : null;
}
export async function importClaude() {
  await importLocalClaude();
  setMode("claude", "imported");
}
export async function credentials(provider: Provider) {
  if (mode(provider) === "gateway")
    return {
      apiKey: null,
      codexAuth: null,
      claudeLogin: false,
      gateway: await gatewayCredentials(provider),
    };
  const key = await apiKey(provider);
  return {
    gateway: null,
    apiKey: key,
    claudeLogin:
      provider === "claude" &&
      ["native", "imported"].includes(mode(provider) ?? "") &&
      (await claudeNativeStatus()),
    codexAuth:
      provider === "codex" && mode(provider) === "imported"
        ? importedCodexAuth()
        : null,
  };
}
export async function connection(provider: Provider) {
  if (mode(provider) === "gateway") {
    const profile = gatewayProfile(provider);
    const available =
      profile?.credential.type !== "environment" ||
      Boolean(process.env[profile.credential.variable]);
    return {
      ready: Boolean(profile && available),
      source: profile
        ? `Gateway · ${new URL(profile.baseUrl).host}`
        : "Gateway settings need attention",
      mode: "gateway" as const,
      canImport: false,
      canImportGateway: canImportGateway(provider),
    };
  }
  const key = await apiKey(provider);
  const selected = mode(provider);
  const imported =
    provider === "codex" &&
    selected === "imported" &&
    Boolean(importedCodexAuth());
  const native =
    provider === "claude" &&
    ["native", "imported"].includes(selected ?? "") &&
    (await claudeNativeStatus());
  return {
    mode: "direct" as const,
    canImportGateway: canImportGateway(provider),
    ready: Boolean(key || imported || native),
    source: native
      ? selected === "imported"
        ? "Imported Claude Code login"
        : "Claude Code login"
      : imported
        ? "Imported Codex login"
        : key
          ? selected !== "key" &&
            (provider === "codex"
              ? process.env.OPENAI_API_KEY
              : process.env.ANTHROPIC_API_KEY)
            ? "Environment"
            : "macOS Keychain"
          : "Not connected",
    canImport: provider === "codex" ? canImport() : await canImportClaude(),
  };
}
