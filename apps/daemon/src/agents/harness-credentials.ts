import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  modelProviderSchema,
  type ModelProvider,
  type Provider,
} from "@nerilo/protocol";

export type HarnessKeys = Partial<Record<ModelProvider, string>>;
export const harnessEnvironment: Record<ModelProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};
export function environmentHarnessKeys(): HarnessKeys {
  return Object.fromEntries(
    Object.entries(harnessEnvironment).flatMap(([provider, variable]) => {
      const key = process.env[variable]?.trim();
      return key ? [[provider, key]] : [];
    }),
  );
}

// Import only literal API keys. OAuth credentials, shell helpers and arbitrary
// environment lookups belong to the source CLI and are never evaluated here.
export function parseHarnessKeys(
  provider: Provider,
  value: unknown,
): HarnessKeys {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    modelProviderSchema.options.flatMap((name) => {
      const entry = (value as Record<string, unknown>)[name];
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        return [];
      const record = entry as Record<string, unknown>;
      const key = record.key;
      const type = provider === "opencode" ? "api" : "api_key";
      return record.type === type &&
        typeof key === "string" &&
        /^[\x21-\x7E]{10,4096}$/.test(key) &&
        !key.startsWith("!") &&
        !(provider === "pi" && key.includes("$"))
        ? [[name, key]]
        : [];
    }),
  );
}
export function localHarnessKeys(provider: Provider): HarnessKeys {
  const path =
    provider === "opencode"
      ? join(
          process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"),
          "opencode/auth.json",
        )
      : join(
          process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi/agent"),
          "auth.json",
        );
  try {
    return parseHarnessKeys(provider, JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return {};
  }
}
