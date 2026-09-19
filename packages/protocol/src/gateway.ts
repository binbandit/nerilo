import { z } from "zod";

const line = z
  .string()
  .max(8192)
  .regex(/^[^\r\n\x00-\x1f\x7f]*$/, "Use a single line.");
const variable = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, "Enter an environment variable name.");
const headerName = z
  .string()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/, "Invalid header name.")
  .refine(
    (name) =>
      !/^(host|connection|content-length|transfer-encoding|proxy-.*)$/i.test(
        name,
      ),
    "This header is managed by the connection.",
  );
const headers = z.record(headerName, line).refine((value) => {
  const names = Object.keys(value).map((key) => key.toLowerCase());
  return names.length <= 32 && new Set(names).size === names.length;
}, "Use at most 32 distinct headers.");

export const gatewayEnvironment =
  /^(ANTHROPIC_DEFAULT_(OPUS|SONNET|HAIKU)_MODEL(?:_(NAME|DESCRIPTION|SUPPORTED_CAPABILITIES))?|ANTHROPIC_SMALL_FAST_MODEL|CLAUDE_CODE_SUBAGENT_MODEL|CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS|CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS|CLAUDE_CODE_ENABLE_PROMPT_SUGGESTIONS)$/;
export const gatewayCredentialSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("key"), value: line.optional() }),
  z.object({ type: z.literal("environment"), variable }),
  z.object({
    type: z.literal("command"),
    value: z.string().max(8192).optional(),
  }),
]);
export const gatewayInputSchema = z.object({
  baseUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /^[a-z0-9.-]+$/i.test(url.hostname) &&
        !/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)
      );
    }, "Use an HTTPS gateway address with a hostname and no credentials, query, or fragment."),
  model: line.pipe(
    z
      .string()
      .trim()
      .min(1, "Enter your gateway's model ID or alias.")
      .max(120),
  ),
  authHeader: z.enum(["authorization", "x-api-key"]).default("authorization"),
  credential: gatewayCredentialSchema,
  headers: headers.optional(),
  headerEnv: z.record(headerName, variable).optional(),
  env: z
    .record(
      z
        .string()
        .regex(
          gatewayEnvironment,
          "This environment setting is not supported.",
        ),
      line,
    )
    .default({}),
  caCertificate: z.string().max(100000).optional(),
});
export type GatewayInput = z.input<typeof gatewayInputSchema>;
export type GatewayConfig = z.output<typeof gatewayInputSchema>;
export const gatewayViewSchema = gatewayInputSchema
  .pick({ baseUrl: true, model: true, authHeader: true, env: true })
  .extend({
    credential: z.object({
      type: z.enum(["key", "environment", "command"]),
      variable: z.string().optional(),
      configured: z.boolean(),
    }),
    headerNames: z.array(z.string()),
    hasCertificate: z.boolean(),
  });
export type GatewayView = z.infer<typeof gatewayViewSchema>;
