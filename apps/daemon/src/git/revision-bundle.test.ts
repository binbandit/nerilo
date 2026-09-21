import { test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checked } from "../platform/config";
import { bundleRevision } from "./revision-bundle";

test("PR snapshots pin the requested head, retain the comparison base, and leave the source checkout untouched", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerilo-revision-"));
  const source = join(root, "project");
  const snapshot = join(root, "snapshot");
  const git = (...args: string[]) => checked(["git", "-C", source, ...args]);
  try {
    await checked(["git", "init", source]);
    await git("config", "user.name", "Fixture");
    await git("config", "user.email", "fixture@example.test");
    await writeFile(join(source, "file.txt"), "base\n");
    await git("add", ".");
    await git("commit", "-m", "Base");
    const baseCommit = await git("rev-parse", "HEAD");
    await writeFile(join(source, "file.txt"), "PR revision\n");
    await git("commit", "-am", "PR head");
    const headCommit = await git("rev-parse", "HEAD");
    await writeFile(join(source, "file.txt"), "Newer revision\n");
    await git("commit", "-am", "Later push");
    const current = await git("rev-parse", "HEAD");
    await writeFile(join(source, "local.txt"), "Untracked user work\n");
    await mkdir(snapshot);
    await bundleRevision(source, { baseCommit, headCommit }, snapshot);
    const clone = join(root, "container-checkout");
    await checked(["git", "clone", join(snapshot, "source.bundle"), clone]);
    expect(await checked(["git", "-C", clone, "rev-parse", "HEAD"])).toBe(
      headCommit,
    );
    expect(await readFile(join(clone, "file.txt"), "utf8")).toBe(
      "PR revision\n",
    );
    expect(
      await checked(["git", "-C", clone, "diff", `${baseCommit}...HEAD`]),
    ).toContain("+PR revision");
    expect(await git("rev-parse", "HEAD")).toBe(current);
    expect(await git("status", "--porcelain")).toBe("?? local.txt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
