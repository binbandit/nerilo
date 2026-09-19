import { z } from "zod";
import { parseDocument } from "yaml";

export const SKILL_FILE_LIMIT = 1024 * 1024;
export const SKILL_BUNDLE_LIMIT = 4 * SKILL_FILE_LIMIT;
export const SKILLS_TOTAL_LIMIT = 16 * SKILL_FILE_LIMIT;
export const SKILLS_REQUEST_LIMIT = 24 * SKILL_FILE_LIMIT;
const encoder = new TextEncoder();
const skillName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers and single hyphens for the skill name.",
  );
const metadataSchema = z.object({
  name: skillName,
  description: z.string().trim().min(1).max(1024),
});

export const skillFileSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (path) =>
          !/[\\\x00-\x1f\x7f:]/.test(path) &&
          path
            .split("/")
            .every(
              (part) =>
                Boolean(part) &&
                part !== "." &&
                part !== ".." &&
                part !== ".git" &&
                part.length <= 100,
            ),
        "Use relative file paths without parent directory references.",
      ),
    content: z.string().max(Math.ceil(SKILL_FILE_LIMIT / 3) * 4),
    encoding: z.enum(["utf8", "base64"]).default("utf8"),
  })
  .strict()
  .superRefine((file, ctx) => {
    if (
      file.encoding === "base64" &&
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        file.content,
      )
    ) {
      ctx.addIssue({ code: "custom", message: "Invalid base64 file content." });
      return;
    }
    if (skillFileBytes(file) > SKILL_FILE_LIMIT)
      ctx.addIssue({
        code: "custom",
        message: "Each skill file must be 1 MB or smaller.",
      });
  });
export type SkillFile = z.infer<typeof skillFileSchema>;
export function skillFileBytes(file: SkillFile) {
  return file.encoding === "base64"
    ? (file.content.length * 3) / 4 -
        (file.content.endsWith("==") ? 2 : file.content.endsWith("=") ? 1 : 0)
    : encoder.encode(file.content).byteLength;
}

export function skillMetadata(content: string) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (!match)
    throw new Error(
      "SKILL.md must start with YAML frontmatter containing name and description.",
    );
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length)
    throw new Error("Check the YAML frontmatter in SKILL.md.");
  const metadata: unknown = document.toJS({ maxAliasCount: 20 });
  const parsed = metadataSchema.safeParse(metadata);
  if (!parsed.success)
    throw new Error(
      `SKILL.md: ${parsed.error.issues[0].path.join(".")}: ${parsed.error.issues[0].message}`,
    );
  return parsed.data;
}

const bundleSchema = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    enabled: z.boolean().default(true),
    files: z.array(skillFileSchema).min(1).max(128),
    source: z
      .object({
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        revision: z.string().regex(/^[a-f0-9]{40}$/),
        path: z
          .string()
          .max(240)
          .refine(
            (path) =>
              path === "" ||
              (!/[\\\x00-\x1f\x7f:]/.test(path) &&
                path
                  .split("/")
                  .every((part) => part && part !== "." && part !== "..")),
          ),
      })
      .optional(),
  })
  .superRefine((skill, ctx) => {
    const paths = new Set<string>();
    for (const file of skill.files) {
      const path = file.path.toLowerCase();
      if (paths.has(path))
        ctx.addIssue({
          code: "custom",
          message: "Skill file paths must be unique.",
        });
      paths.add(path);
    }
    for (const path of paths)
      if (
        path
          .split("/")
          .slice(0, -1)
          .some((_, index, parts) =>
            paths.has(parts.slice(0, index + 1).join("/")),
          )
      )
        ctx.addIssue({
          code: "custom",
          message: "A skill file cannot also be a folder.",
        });
    if (
      skill.files.reduce((total, file) => total + skillFileBytes(file), 0) >
      SKILL_BUNDLE_LIMIT
    )
      ctx.addIssue({
        code: "custom",
        message: "A skill must be 4 MB or smaller.",
      });
    const manifest = skill.files.find((file) => file.path === "SKILL.md");
    if (!manifest || manifest.encoding !== "utf8") {
      ctx.addIssue({
        code: "custom",
        message: "Include a UTF-8 SKILL.md at the top of the skill folder.",
      });
      return;
    }
    try {
      skillMetadata(manifest.content);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid SKILL.md.",
      });
    }
  });

export function parseAgentSkill(input: unknown) {
  const parsed = bundleSchema.safeParse(input);
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid skill bundle.");
  const skill = parsed.data;
  const manifest = skill.files.find((file) => file.path === "SKILL.md")!;
  return { ...skill, ...skillMetadata(manifest.content) };
}
export const agentSkillSchema = bundleSchema
  .safeExtend({
    name: skillName,
    description: z.string().min(1).max(1024),
  })
  .superRefine((skill, ctx) => {
    const manifest = skill.files.find((file) => file.path === "SKILL.md");
    if (!manifest) return;
    try {
      const metadata = skillMetadata(manifest.content);
      if (
        metadata.name !== skill.name ||
        metadata.description !== skill.description
      )
        ctx.addIssue({
          code: "custom",
          message: "Skill name and description must match SKILL.md.",
        });
    } catch {
      /* Bundle validation reports malformed frontmatter. */
    }
  });
export const agentSkillsSchema = z
  .array(agentSkillSchema)
  .max(32)
  .superRefine((skills, ctx) => {
    if (
      new Set(skills.map((skill) => skill.id)).size !== skills.length ||
      new Set(skills.map((skill) => skill.name)).size !== skills.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Each skill must have a unique name and ID.",
      });
    if (
      skills.reduce(
        (total, skill) =>
          total +
          skill.files.reduce((size, file) => size + skillFileBytes(file), 0),
        0,
      ) > SKILLS_TOTAL_LIMIT
    )
      ctx.addIssue({
        code: "custom",
        message: "Skills must total 16 MB or less.",
      });
  });
export type AgentSkill = z.infer<typeof agentSkillSchema>;
