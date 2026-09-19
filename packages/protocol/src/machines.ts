import { z } from "zod";

export const daemonIdentitySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  platform: z.string(),
  protocolVersion: z.literal(1),
});
export type DaemonIdentity = z.infer<typeof daemonIdentitySchema>;

export const machineNameSchema = z.string().trim().min(1).max(80);
export const machineRegistrationSchema = z.object({
  name: machineNameSchema,
  url: z.string().trim().min(1).max(2048),
  token: z.string().trim().min(16).max(4096),
  machineId: z.uuid().optional(),
});
export const machineUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("rename"), name: machineNameSchema }),
  z.object({ action: z.literal("remove") }),
  z.object({
    action: z.literal("reconnect"),
    url: machineRegistrationSchema.shape.url,
    token: machineRegistrationSchema.shape.token,
    machineId: z.uuid().optional(),
  }),
]);
export const machineSchema = z.object({
  id: z.union([z.literal("local"), z.uuid()]),
  name: machineNameSchema,
  url: z.string(),
  daemonId: z.uuid().nullable(),
  platform: z.string().nullable(),
  status: z.enum(["online", "offline"]),
  error: z.string().nullable(),
});
export const machinesSchema = z.object({ machines: z.array(machineSchema) });
export type Machine = z.infer<typeof machineSchema>;
