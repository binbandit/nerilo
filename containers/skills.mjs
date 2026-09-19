import { mkdir, writeFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SKILLS_PATH = "/tmp/nerilo-skills";

export async function clearSkills(root = SKILLS_PATH) {
  await rm(root, { recursive: true, force: true });
}

export async function prepareSkills(provider, skills = [], root = SKILLS_PATH) {
  await clearSkills(root);
  const enabled = skills.filter((skill) => skill.enabled);
  const names = new Set();
  // Validate before writing, even though the daemon also validates imports.
  for (const skill of enabled) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) ||
      skill.name.length > 64 ||
      names.has(skill.name)
    )
      throw new Error("Invalid or duplicate skill name.");
    names.add(skill.name);
    const paths = new Set();
    for (const file of skill.files) {
      if (
        !file.path ||
        /[\\\x00-\x1f\x7f]/.test(file.path) ||
        file.path
          .split("/")
          .some((part) => !part || part === "." || part === "..") ||
        paths.has(file.path) ||
        !["utf8", "base64"].includes(file.encoding ?? "utf8")
      )
        throw new Error("Invalid skill file path or encoding.");
      paths.add(file.path);
    }
    if (!paths.has("SKILL.md")) throw new Error("Skill is missing SKILL.md.");
  }
  if (!enabled.length) return { args: [] };
  try {
    await mkdir(root, { mode: 0o700 });
    for (const skill of enabled) {
      const folder = join(root, "skills", skill.name);
      for (const file of skill.files) {
        const path = join(folder, file.path);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const content = Buffer.from(file.content, file.encoding ?? "utf8");
        await writeFile(path, content, {
          mode: content.subarray(0, 2).toString() === "#!" ? 0o700 : 0o600,
          flag: "wx",
        });
      }
    }
    if (provider === "claude") {
      await mkdir(join(root, ".claude-plugin"), { mode: 0o700 });
      await writeFile(
        join(root, ".claude-plugin", "plugin.json"),
        JSON.stringify({ name: "nerilo", version: "1.0.0" }),
        { mode: 0o600, flag: "wx" },
      );
      return { args: ["--plugin-dir", root] };
    }
    return { args: [] };
  } catch (error) {
    await clearSkills(root);
    throw error;
  }
}
