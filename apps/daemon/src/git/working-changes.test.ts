import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checked } from "../platform/config";
import { workingChanges } from "./working-changes";

test("local snapshots preserve staged work and include new files only when requested", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerilo-working-"));
  const repo = join(root, "repo");
  const git = (...args: string[]) => checked(["git", "-C", repo, ...args]);
  try {
    await checked(["git", "init", repo]);
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "fixture@example.test");
    await writeFile(join(repo, ".gitignore"), ".env\n");
    await writeFile(join(repo, "file.txt"), "original\n");
    await git("add", ".");
    await git("commit", "-m", "Base");
    await writeFile(join(repo, "file.txt"), "staged\n");
    await git("add", "file.txt");
    await writeFile(join(repo, "file.txt"), "working with trailing space \n");
    await writeFile(join(repo, "new file.txt"), "new\n");
    await writeFile(join(repo, ".env"), "excluded\n");
    const index = await readFile(join(repo, ".git/index"));
    for (const include of [false, true]) {
      const directory = join(root, String(include));
      await mkdir(directory);
      const patch = await workingChanges(repo, directory, include);
      expect(patch.includes("new file.txt")).toBe(include);
      expect(patch).not.toContain("excluded");
      expect(patch).toContain("+working with trailing space \n");
      const clone = join(directory, "clone");
      await checked(["git", "clone", repo, clone]);
      await checked(["git", "-C", clone, "apply", "-"], { input: patch });
      expect(await readFile(join(clone, "file.txt"), "utf8")).toBe(
        "working with trailing space \n",
      );
    }
    expect(await readFile(join(repo, ".git/index"))).toEqual(index);
    expect(await git("show", ":file.txt")).toBe("staged");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

test("local snapshots stay appliable under user diff settings", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerilo-working-"));
  const repo = join(root, "repo");
  const git = (...args: string[]) => checked(["git", "-C", repo, ...args]);
  try {
    await checked(["git", "init", repo]);
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "fixture@example.test");
    await writeFile(join(repo, "file.txt"), "original\n");
    await git("add", ".");
    await git("commit", "-m", "Base");
    await git("config", "diff.noprefix", "true");
    await git("config", "color.ui", "always");
    await writeFile(join(repo, "file.txt"), "changed\n");
    const patch = await workingChanges(repo, root, false);
    expect(patch).toContain("diff --git a/file.txt b/file.txt");
    expect(patch).not.toContain("\x1b[");
    const clone = join(root, "clone");
    await checked(["git", "clone", repo, clone]);
    await checked(["git", "-C", clone, "apply", "-"], { input: patch });
    expect(await readFile(join(clone, "file.txt"), "utf8")).toBe("changed\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
