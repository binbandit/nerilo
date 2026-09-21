import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gitActionSchema } from "@nerilo/protocol";
import { checked } from "../platform/config";
import { readPullRequestTemplates } from "./pull-request-templates";

test("discovers committed GitHub template locations and preserves Markdown exactly", async () => {
  const path = await mkdtemp(join(tmpdir(), "nerilo-pr-templates-"));
  try {
    const git = ["git", "-C", path];
    await checked([...git, "init", "-b", "main"]);
    const body = "\n## Summary\n\n<!-- Explain why -->\n- [ ] Tested\n\n";
    const paths = [
      "PULL_REQUEST_TEMPLATE.md",
      ".github/pull_request_template.md",
      "docs/pull_request_template.txt",
      ".github/PULL_REQUEST_TEMPLATE/feature.md",
      "docs/PULL_REQUEST_TEMPLATE/bug.md",
      "PULL_REQUEST_TEMPLATE/change.markdown",
    ];
    for (const file of paths) {
      await mkdir(dirname(join(path, file)), { recursive: true });
      await Bun.write(join(path, file), body);
    }
    await Bun.write(join(path, "README.md"), "Not a template");
    await Bun.write(
      join(path, ".github/PULL_REQUEST_TEMPLATE/too-large.md"),
      "x".repeat(60001),
    );
    await symlink(
      "../../README.md",
      join(path, ".github/PULL_REQUEST_TEMPLATE/link.md"),
    );
    await checked([...git, "add", "."]);
    await checked([
      ...git,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Templates",
    ]);
    // The checkout can change; templates must still come from committed blobs.
    await Bun.write(join(path, paths[0]), "Uncommitted edit");
    await Bun.write(
      join(path, ".github/PULL_REQUEST_TEMPLATE/untracked.md"),
      "Untracked",
    );
    const templates = await readPullRequestTemplates(path);
    expect(templates.map((item) => item.path).sort()).toEqual(paths.sort());
    expect(templates.every((item) => item.body === body)).toBe(true);
    await checked([...git, "rm", "-rf", "."]);
    await checked([
      ...git,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Remove templates",
    ]);
    expect(await readPullRequestTemplates(path)).toEqual([]);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("accepts long Markdown PR descriptions without trimming and rejects overflow", () => {
  const body = "\n## Changes\n" + "Long description.\n".repeat(2000) + "\n";
  const action = {
    action: "pull-request",
    turnId: "turn",
    reviewToken: "review",
    title: "Changes",
    base: "main",
    body,
  };
  expect(gitActionSchema.parse(action)).toMatchObject({ body });
  expect(
    gitActionSchema.safeParse({ ...action, body: "x".repeat(60001) }).success,
  ).toBe(false);
});
