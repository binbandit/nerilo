import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { SKILL_FILE_LIMIT } from "@nerilo/protocol";
import {
  githubSkillImportSchema,
  githubSkillRepository,
} from "@nerilo/protocol";
import { discoverGithubSkills, importGithubSkill } from "./skill-sources";

const revision = "a".repeat(40);
const treeSha = "b".repeat(40);
const manifest =
  "---\nname: repo-review\ndescription: Review repository changes.\n---\nRead references/guide.md.\n";
function fixture(
  extra: {
    path: string;
    bytes: Buffer;
    mode?: string;
    type?: string;
    size?: number;
  }[] = [],
  truncated = false,
  manifestBytes = Buffer.from(manifest),
) {
  const source = [
    { path: "skills/review/SKILL.md", bytes: manifestBytes },
    ...extra,
  ];
  const files = source.map((file) => ({
    ...file,
    sha: createHash("sha1")
      .update(`blob ${file.bytes.length}\0`)
      .update(file.bytes)
      .digest("hex"),
  }));
  const calls: string[] = [];
  const request = async (path: string): Promise<unknown> => {
    calls.push(path);
    if (path.includes("/commits/"))
      return { sha: revision, commit: { tree: { sha: treeSha } } };
    if (path.includes("/git/trees/"))
      return {
        truncated,
        tree: files.map((file) => ({
          path: file.path,
          sha: file.sha,
          mode: file.mode ?? "100644",
          type: file.type ?? "blob",
          size: file.size ?? file.bytes.length,
        })),
      };
    const file = files.find((item) => path.endsWith(item.sha));
    if (!file) throw new Error("Unexpected fixture request");
    return {
      encoding: "base64",
      size: file.bytes.length,
      content: `${file.bytes.toString("base64")}\n`,
    };
  };
  return { request, calls };
}
const selection = {
  repository: "example/skills",
  revision,
  path: "skills/review",
};

test("GitHub skill selection accepts repository URLs and rejects ambiguous or unsafe sources", () => {
  expect(githubSkillRepository("https://github.com/example/skills.git/")).toBe(
    "example/skills",
  );
  expect(githubSkillRepository("example/skills")).toBe("example/skills");
  for (const url of [
    "https://github.com.evil.test/example/skills",
    "https://token@github.com/example/skills",
    "http://github.com/example/skills",
    "https://github.com/example/skills/tree/main",
    "example/../skills",
    "https://github.com/example/skills?token=secret",
  ])
    expect(() => githubSkillRepository(url)).toThrow();
  for (const path of [
    "../outside",
    "/absolute",
    "a\\b",
    ".git",
    "folder//skill",
  ])
    expect(
      githubSkillImportSchema.safeParse({ ...selection, path }).success,
    ).toBe(false);
  expect(
    githubSkillImportSchema.safeParse({ ...selection, revision: "main" })
      .success,
  ).toBe(false);
});

test("discovery pins a commit and lists manifests without downloading bundles", async () => {
  const fake = fixture([
    { path: "SKILL.md", bytes: Buffer.from(manifest) },
    { path: "other/readme.md", bytes: Buffer.from("unrelated") },
  ]);
  const result = await discoverGithubSkills(
    { url: "example/skills", ref: "feature/skills" },
    fake.request,
  );
  expect(result).toEqual({
    repository: "example/skills",
    revision,
    skills: [{ path: "" }, { path: "skills/review" }],
  });
  expect(fake.calls).toEqual([
    "repos/example/skills/commits/feature%2Fskills",
    `repos/example/skills/git/trees/${treeSha}?recursive=1`,
  ]);
  await expect(
    discoverGithubSkills({ url: "example/skills" }, fixture([], true).request),
  ).rejects.toThrow("only part");
});

test("GitHub imports selected revision with exact binary assets and source provenance", async () => {
  const bytes = Buffer.from([0, 255, 3, 128]);
  const fake = fixture([
    { path: "skills/review/assets/sample.bin", bytes },
    { path: "other/SKILL.md", bytes: Buffer.from(manifest) },
  ]);
  const skill = await importGithubSkill(selection, fake.request);
  expect(skill.name).toBe("repo-review");
  expect(skill.files).toHaveLength(2);
  expect(skill.files.find((file) => file.path === "SKILL.md")?.content).toBe(
    manifest,
  );
  const asset = skill.files.find((file) => file.path === "assets/sample.bin")!;
  expect(Buffer.from(asset.content, "base64")).toEqual(bytes);
  expect(skill.source).toEqual(selection);
  expect(fake.calls[0]).toEndWith(`/commits/${revision}`);
  expect(
    fake.calls.filter((path) => path.includes("/git/blobs/")),
  ).toHaveLength(2);
});

test("unsafe and oversized GitHub bundles fail before downloading files", async () => {
  for (const extra of [
    [
      {
        path: "skills/review/link",
        bytes: Buffer.from("/etc/passwd"),
        mode: "120000",
      },
    ],
    [
      {
        path: "skills/review/submodule",
        bytes: Buffer.from("x"),
        mode: "160000",
        type: "commit",
      },
    ],
    [{ path: "skills/review/../outside", bytes: Buffer.from("x") }],
    [
      {
        path: "skills/review/large",
        bytes: Buffer.from("x"),
        size: SKILL_FILE_LIMIT + 1,
      },
    ],
    Array.from({ length: 128 }, (_, index) => ({
      path: `skills/review/file-${index}`,
      bytes: Buffer.from("x"),
    })),
    Array.from({ length: 5 }, (_, index) => ({
      path: `skills/review/file-${index}`,
      bytes: Buffer.from("x"),
      size: SKILL_FILE_LIMIT,
    })),
  ]) {
    const fake = fixture(extra);
    await expect(importGithubSkill(selection, fake.request)).rejects.toThrow();
    expect(fake.calls.some((path) => path.includes("/git/blobs/"))).toBe(false);
  }
  await expect(
    importGithubSkill({ ...selection, path: "missing" }, fixture().request),
  ).rejects.toThrow("does not contain");
});

test("import rejects corrupt GitHub blob responses and invalid UTF-8 manifests", async () => {
  const fake = fixture();
  await expect(
    importGithubSkill(selection, async (path) =>
      path.includes("/git/blobs/")
        ? {
            encoding: "base64",
            size: Buffer.byteLength(manifest),
            content: Buffer.from(manifest.replace("Review", "Ignore")).toString(
              "base64",
            ),
          }
        : fake.request(path),
    ),
  ).rejects.toThrow("does not match");
  await expect(
    importGithubSkill(selection, async (path) =>
      path.includes("/git/blobs/")
        ? {
            encoding: "base64",
            size: Buffer.byteLength(manifest),
            content: "%%%",
          }
        : fake.request(path),
    ),
  ).rejects.toThrow("incomplete");
});

test("GitHub manifests retain a BOM and reject invalid UTF-8", async () => {
  const withBom = `\uFEFF${manifest}`;
  const valid = await importGithubSkill(
    selection,
    fixture([], false, Buffer.from(withBom)).request,
  );
  expect(valid.files[0].content).toBe(withBom);
  await expect(
    importGithubSkill(
      selection,
      fixture([], false, Buffer.from([0xff, 0xfe])).request,
    ),
  ).rejects.toThrow("UTF-8");
});
