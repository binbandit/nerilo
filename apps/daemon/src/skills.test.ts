import { expect, test } from "bun:test";
import {
  parseAgentSkill,
  agentSkillsSchema,
  settingsSchema,
  SKILL_FILE_LIMIT,
} from "@nerilo/protocol";
import { Store } from "./store";
import { Engine } from "./engine";
import { createApi } from "./api";

const manifest =
  "---\nname: review-guide\ndescription: |\n  Review changes carefully.\n  Use when reviewing a pull request.\nallowed-tools: Read\n---\nRead references/review.md first.\n";
const skill = parseAgentSkill({
  id: "review",
  enabled: true,
  files: [
    { path: "SKILL.md", content: manifest, encoding: "utf8" },
    {
      path: "references/review.md",
      content: "Check the edge cases.",
      encoding: "utf8",
    },
    { path: "assets/pixel.bin", content: "AAEC/w==", encoding: "base64" },
  ],
});

test("skill manifests preserve provider fields, multiline descriptions and supporting assets", () => {
  expect(skill.name).toBe("review-guide");
  expect(skill.description).toBe(
    "Review changes carefully.\nUse when reviewing a pull request.",
  );
  expect(skill.files[0].content).toBe(manifest);
  expect(agentSkillsSchema.parse([skill])[0].files).toEqual(skill.files);
  expect(settingsSchema.parse({}).skills).toEqual([]);
});

test("skill validation rejects unsafe bundles, invalid manifests and mismatched metadata", () => {
  for (const path of [
    "../outside",
    "/absolute",
    "a/../../outside",
    "a\\b",
    "a//b",
    "a/./b",
    ".git/config",
    "C:/a",
    "nul\0name",
  ]) {
    expect(() =>
      parseAgentSkill({
        ...skill,
        files: [...skill.files, { path, content: "x" }],
      }),
    ).toThrow();
  }
  for (const content of [
    "No frontmatter",
    "---\nname: ../bad\ndescription: bad\n---",
    "---\nname: valid\n---",
    "---\nname: a\nname: b\ndescription: bad\n---",
    "---\nname: [invalid\ndescription: broken\n---",
  ]) {
    expect(() =>
      parseAgentSkill({ ...skill, files: [{ path: "SKILL.md", content }] }),
    ).toThrow();
  }
  for (const files of [
    skill.files.slice(1),
    [...skill.files, skill.files[0]],
    [...skill.files, { path: "references", content: "conflict" }],
    [
      ...skill.files,
      { path: "assets/bad", content: "%%%%", encoding: "base64" },
    ],
    [
      {
        path: "SKILL.md",
        content: Buffer.from(manifest).toString("base64"),
        encoding: "base64",
      },
    ],
    [...skill.files, { path: "big", content: "é".repeat(SKILL_FILE_LIMIT) }],
  ])
    expect(() => parseAgentSkill({ ...skill, files })).toThrow();
  expect(
    agentSkillsSchema.safeParse([{ ...skill, name: "spoofed" }]).success,
  ).toBe(false);
  expect(
    agentSkillsSchema.safeParse([skill, { ...skill, id: "other" }]).success,
  ).toBe(false);
  expect(
    agentSkillsSchema.safeParse([skill, { ...skill, name: "other" }]).success,
  ).toBe(false);
});

test("skills API saves bundles above the normal request limit, preserves other settings and rejects invalid updates", async () => {
  const store = new Store(":memory:");
  const api = createApi(store, new Engine(store, true), "test");
  const post = (path: string, body: unknown, token = "test") =>
    api(
      new Request(`http://localhost/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      }),
    );
  try {
    const previous = store.get("settings", "default")!;
    const large = parseAgentSkill({
      ...skill,
      files: [
        ...skill.files,
        { path: "references/large.md", content: "x".repeat(120000) },
      ],
    });
    expect((await post("skills", { skills: [large] }, "wrong")).status).toBe(
      401,
    );
    expect((await post("skills", { skills: [large] })).status).toBe(200);
    expect(store.get("settings", "default")?.skills).toEqual([large]);
    expect(store.get("settings", "default")?.mcpServers).toEqual(
      previous.mcpServers,
    );
    expect(
      (await post("skills", { skills: [{ ...skill, name: "wrong" }] })).status,
    ).toBeGreaterThanOrEqual(400);
    expect(store.get("settings", "default")?.skills).toEqual([large]);
    await post("settings", { appearance: "dark", skills: [] });
    expect(store.get("settings", "default")?.skills).toEqual([large]);
    expect((await post("settings", { large: "x".repeat(120000) })).status).toBe(
      413,
    );
    expect(
      JSON.stringify(store.db.query("SELECT text FROM events").all()),
    ).not.toContain("Read references");
    await post("skills", { skills: [{ ...skill, enabled: false }] });
    expect(store.get("settings", "default")?.skills[0].enabled).toBe(false);
    await post("skills", { skills: [] });
    expect(store.get("settings", "default")?.skills).toEqual([]);
  } finally {
    store.db.close();
  }
});
