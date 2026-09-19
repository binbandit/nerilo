import { z } from "zod";
export const sandboxDefaults = {
  workspace: "write" as const,
  cpus: 2,
  memoryMB: 4096,
  pids: 256,
  network: "internet" as const,
};
export const sandboxSchema = z.object({
  workspace: z.enum(["write", "read-only"]),
  cpus: z.number().min(0.25).max(16),
  memoryMB: z.number().int().min(512).max(32768),
  pids: z.number().int().min(64).max(1024),
  network: z.enum(["internet", "provider-only"]).default("internet"),
});
export type Sandbox = z.infer<typeof sandboxSchema>;
