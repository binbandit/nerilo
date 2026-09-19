import { z } from "zod";

const text = z
  .string()
  .max(8000)
  .refine(
    (value) => !value.includes("\0"),
    "Must not contain null characters.",
  );
const base = {
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
};
export const mcpServerSchema = z.discriminatedUnion("transport", [
  z
    .object({
      ...base,
      transport: z.literal("stdio"),
      command: z
        .string()
        .trim()
        .min(1)
        .max(2000)
        .refine(
          (value) => !/[\0\r\n]/.test(value),
          "Enter one executable, with arguments in Arguments.",
        ),
      args: z.array(text).max(64).default([]),
      env: z
        .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), text)
        .default({}),
    })
    .strict(),
  z
    .object({
      ...base,
      transport: z.literal("http"),
      url: z
        .string()
        .trim()
        .url()
        .max(4000)
        .refine((value) => {
          try {
            const url = new URL(value);
            return (
              ["https:", "http:"].includes(url.protocol) &&
              !url.username &&
              !url.password &&
              !url.hash
            );
          } catch {
            return false;
          }
        }, "Use an HTTP or HTTPS endpoint without URL credentials or a fragment. Put authentication in Headers."),
      headers: z
        .record(
          z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
          text.refine(
            (value) => !/[\r\n]/.test(value),
            "Header values must be on one line.",
          ),
        )
        .default({}),
    })
    .strict(),
]);
export const mcpServersSchema = z
  .array(mcpServerSchema)
  .max(32)
  .superRefine((servers, ctx) => {
    const ids = new Set<string>();
    const names = new Set<string>();
    servers.forEach((server, index) => {
      if (ids.has(server.id))
        ctx.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Server IDs must be unique.",
        });
      if (names.has(server.name.toLowerCase()))
        ctx.addIssue({
          code: "custom",
          path: [index, "name"],
          message: "Choose a distinct server name.",
        });
      ids.add(server.id);
      names.add(server.name.toLowerCase());
    });
  });
export type McpServer = z.infer<typeof mcpServerSchema>;
