import {
  SKILL_FILE_LIMIT,
  SKILL_BUNDLE_LIMIT,
  type SkillFile,
} from "@nerilo/protocol";

export async function importSkillFiles(
  files: readonly File[],
  folder: boolean,
): Promise<SkillFile[]> {
  if (!files.length) throw new Error("Choose a SKILL.md file or skill folder.");
  if (files.length > 128)
    throw new Error("A skill can contain up to 128 files.");
  if (files.some((file) => file.size > SKILL_FILE_LIMIT))
    throw new Error("Each skill file must be 1 MB or smaller.");
  if (files.reduce((size, file) => size + file.size, 0) > SKILL_BUNDLE_LIMIT)
    throw new Error("A skill must be 4 MB or smaller.");
  const root = folder ? files[0].webkitRelativePath?.split("/")[0] : "";
  const paths = files.map((file) => {
    if (!folder) return file.name;
    const parts = file.webkitRelativePath?.split("/") ?? [];
    if (parts.length < 2 || parts[0] !== root)
      throw new Error("Choose a single folder containing SKILL.md.");
    return parts.slice(1).join("/");
  });
  if (!paths.includes("SKILL.md"))
    throw new Error("Choose the folder with SKILL.md directly inside it.");
  return Promise.all(
    files.map(async (file, index) => {
      const path = paths[index];
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const content = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes);
        if (content.includes("\0")) throw new Error("Binary file");
        return { path, content, encoding: "utf8" as const };
      } catch {
        if (path === "SKILL.md")
          throw new Error("SKILL.md must be a UTF-8 text file.");
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { path, content: btoa(binary), encoding: "base64" as const };
      }
    }),
  );
}
