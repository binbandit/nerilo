import { z } from "zod";

export const providerSchema = z.enum(["codex", "claude", "opencode", "pi"]);
export type Provider = z.infer<typeof providerSchema>;
export const providerNames: Record<Provider, string> = {
  codex: "Codex",
  claude: "Claude Code",
  opencode: "OpenCode",
  pi: "Pi",
};
export const isMultiProviderHarness = (provider: Provider) =>
  provider === "opencode" || provider === "pi";

export const modelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "google",
  "openrouter",
]);
export type ModelProvider = z.infer<typeof modelProviderSchema>;
export const modelProviderNames: Record<ModelProvider, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
};
export const defaultHarnessModels: Record<ModelProvider, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-5.4",
  google: "gemini-2.5-pro",
  openrouter: "anthropic/claude-sonnet-4.6",
};
