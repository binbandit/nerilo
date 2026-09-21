import { z } from "zod";

export const folderListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  directories: z.array(z.object({ name: z.string(), path: z.string() })),
  selectable: z.boolean(),
  reason: z.string().nullable(),
});
export type FolderListing = z.infer<typeof folderListingSchema>;
