import { test, expect } from "bun:test";
import {
  mkdtemp,
  readFile,
  stat,
  access,
  writeFile,
  mkdir,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareSkills, clearSkills } from "./skills.mjs";

const skill = {
  id: "fixture",
  name: "fixture-skill",
  enabled: true,
  files: [
    {
      path: "SKILL.md",
      content:
        "---\nname: fixture-skill\ndescription: Fixture\n---\nUse scripts/probe.sh",
      encoding: "utf8",
    },
    {
      path: "scripts/probe.sh",
      content: "#!/bin/sh\necho fixture\n",
      encoding: "utf8",
    },
    {
      path: "assets/pixel.bin",
      content: Buffer.from([0, 255, 13, 128]).toString("base64"),
      encoding: "base64",
    },
  ],
};

test("skills use native isolated directories with executable scripts and intact binary assets", async () => {
  const parent = await mkdtemp(join(tmpdir(), "nerilo-skills-test-"));
  const root = join(parent, "skills");
  try {
    expect(await prepareSkills("codex", [skill], root)).toEqual({ args: [] });
    const folder = join(root, "skills", skill.name);
    expect(await readFile(join(folder, "SKILL.md"), "utf8")).toBe(
      skill.files[0].content,
    );
    expect(await readFile(join(folder, "assets/pixel.bin"))).toEqual(
      Buffer.from([0, 255, 13, 128]),
    );
    expect((await stat(join(folder, "scripts/probe.sh"))).mode & 0o777).toBe(
      0o700,
    );
    expect((await stat(join(folder, "SKILL.md"))).mode & 0o777).toBe(0o600);
    expect(await prepareSkills("claude", [skill], root)).toEqual({
      args: ["--plugin-dir", root],
    });
    expect(
      JSON.parse(
        await readFile(join(root, ".claude-plugin/plugin.json"), "utf8"),
      ),
    ).toEqual({ name: "nerilo", version: "1.0.0" });
    expect(
      await prepareSkills("claude", [{ ...skill, enabled: false }], root),
    ).toEqual({ args: [] });
    expect(
      await access(root).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    await clearSkills(root);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("skill staging rejects traversal and cleans partial writes without following stale symlinks", async () => {
  const parent = await mkdtemp(join(tmpdir(), "nerilo-skills-test-"));
  const root = join(parent, "skills");
  const outside = join(parent, "outside");
  try {
    await mkdir(outside);
    await writeFile(join(outside, "keep.txt"), "retained");
    await symlink(outside, root);
    await prepareSkills("codex", [skill], root);
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("retained");
    for (const path of [
      "../escape",
      "/escape",
      "a/../../escape",
      "a\\escape",
      "a//escape",
      "a/./escape",
    ]) {
      await expect(
        prepareSkills(
          "codex",
          [{ ...skill, files: [...skill.files, { path, content: "escape" }] }],
          root,
        ),
      ).rejects.toThrow("Invalid skill file");
      expect(
        await access(root).then(
          () => true,
          () => false,
        ),
      ).toBe(false);
    }
    await expect(
      prepareSkills("codex", [{ ...skill, name: "../escape" }], root),
    ).rejects.toThrow("Invalid or duplicate");
    await expect(prepareSkills("codex", [skill, skill], root)).rejects.toThrow(
      "Invalid or duplicate",
    );
    await expect(
      prepareSkills(
        "codex",
        [
          {
            ...skill,
            files: [
              { path: "references", content: "file" },
              { path: "references/child", content: "nested" },
              skill.files[0],
            ],
          },
        ],
        root,
      ),
    ).rejects.toThrow();
    expect(
      await access(root).then(
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("retained");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
