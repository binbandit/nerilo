import { describe, expect, test } from "bun:test";
import { importSkillFiles } from "@/features/skills/skill-import";

function folderFile(content: BlobPart, path: string) {
  const file = new File([content], path.split("/").at(-1)!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

describe("skill file import", () => {
  test("strips only the chosen root and preserves UTF-8 and binary resources", async () => {
    const files = await importSkillFiles(
      [
        folderFile(
          "---\nname: demo\ndescription: café\n---\n",
          "demo/SKILL.md",
        ),
        folderFile("\uFEFF#!/bin/sh\nprintf 'hello'\n", "demo/scripts/run.sh"),
        folderFile(
          new Uint8Array([0, 255, 64, 128]),
          "demo/assets/example.bin",
        ),
      ],
      true,
    );
    expect(files.map((file) => file.path)).toEqual([
      "SKILL.md",
      "scripts/run.sh",
      "assets/example.bin",
    ]);
    expect(files[0].encoding).toBe("utf8");
    expect(files[0].content).toContain("café");
    expect(files[1].content).toBe("\uFEFF#!/bin/sh\nprintf 'hello'\n");
    expect(files[2]).toEqual({
      path: "assets/example.bin",
      content: "AP9AgA==",
      encoding: "base64",
    });
  });

  test("requires the actual skill folder and a UTF-8 manifest", async () => {
    await expect(
      importSkillFiles([folderFile("text", "outer/demo/SKILL.md")], true),
    ).rejects.toThrow("directly inside");
    await expect(
      importSkillFiles([new File([new Uint8Array([255])], "SKILL.md")], false),
    ).rejects.toThrow("UTF-8");
    await expect(
      importSkillFiles([new File(["text"], "readme.md")], false),
    ).rejects.toThrow("SKILL.md");
    expect(
      await importSkillFiles([new File(["text"], "SKILL.md")], false),
    ).toEqual([{ path: "SKILL.md", content: "text", encoding: "utf8" }]);
  });

  test("rejects oversized imports before reading file contents", async () => {
    const large = new File([new Uint8Array(1024 * 1024 + 1)], "SKILL.md");
    await expect(importSkillFiles([large], false)).rejects.toThrow("1 MB");
    const many = Array.from({ length: 129 }, (_, index) =>
      folderFile("", `demo/${index}.md`),
    );
    await expect(importSkillFiles(many, true)).rejects.toThrow("128 files");
  });
});
