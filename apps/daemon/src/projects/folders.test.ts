import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { checked } from "../platform/config";
import { listFolders } from "./folders";

let root: string;
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "nerilo-folders-")));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function repository() {
  const path = join(root, "repo");
  await checked(["git", "init", path]);
  return path;
}
async function commit(path: string) {
  await checked([
    "git",
    "-C",
    path,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Initial",
  ]);
}

test("defaults to the canonical home directory", async () => {
  expect((await listFolders()).path).toBe(await realpath(homedir()));
});

test("lists only visible directories and navigates canonical parents up to root", async () => {
  await mkdir(join(root, "Zulu"));
  await mkdir(join(root, "Alpha"));
  await mkdir(join(root, ".hidden"));
  await writeFile(join(root, "file"), "text");
  const listing = await listFolders(root);
  expect(listing.directories).toEqual([
    { name: "Alpha", path: join(root, "Alpha") },
    { name: "Zulu", path: join(root, "Zulu") },
  ]);
  expect(listing.selectable).toBe(false);
  expect(listing.parent).toBe(dirname(root));
  const child = await listFolders(listing.directories[0]!.path);
  expect((await listFolders(child.parent!)).path).toBe(root);
  expect((await listFolders("/")).parent).toBeNull();
});

test("only committed repository roots can be selected, including detached HEAD and worktrees", async () => {
  const path = await repository();
  expect(await listFolders(path)).toMatchObject({
    selectable: false,
    reason: "This repository needs at least one commit.",
  });
  await commit(path);
  expect(await listFolders(path)).toMatchObject({
    selectable: true,
    reason: null,
  });
  await mkdir(join(path, "nested"));
  expect(await listFolders(join(path, "nested"))).toMatchObject({
    selectable: false,
    reason: "Choose the repository root folder.",
  });
  await checked(["git", "-C", path, "checkout", "--detach"]);
  expect((await listFolders(path)).selectable).toBe(true);
  const worktree = join(root, "worktree");
  await checked(["git", "-C", path, "worktree", "add", "--detach", worktree]);
  expect((await listFolders(worktree)).selectable).toBe(true);
  const bare = join(root, "bare");
  await checked(["git", "clone", "--bare", path, bare]);
  expect((await listFolders(bare)).selectable).toBe(false);
});

test("resolves directory symlinks consistently and ignores broken links and file links", async () => {
  const path = await repository();
  await commit(path);
  const aliases = join(root, "aliases");
  await mkdir(aliases);
  await symlink(path, join(aliases, "repo-link"));
  await symlink(join(root, "missing"), join(aliases, "broken"));
  await writeFile(join(root, "file"), "text");
  await symlink(join(root, "file"), join(aliases, "file-link"));
  expect((await listFolders(aliases)).directories).toEqual([
    { name: "repo-link", path },
  ]);
  expect(await listFolders(join(aliases, "repo-link"))).toMatchObject({
    path,
    parent: root,
    selectable: true,
  });
});

test("rejects invalid input and reports missing, removed, non-directory and looping paths", async () => {
  for (const input of [
    "",
    "relative",
    "~/repo",
    "/tmp/\0bad",
    "/tmp/\nbad",
    "/" + "x".repeat(2000),
  ])
    await expect(listFolders(input)).rejects.toMatchObject({ status: 400 });
  const removed = join(root, "removed");
  await mkdir(removed);
  await rm(removed, { recursive: true });
  await writeFile(join(root, "file"), "text");
  await symlink(join(root, "loop"), join(root, "loop"));
  for (const path of [
    removed,
    join(root, "missing"),
    join(root, "file"),
    join(root, "loop"),
  ])
    await expect(listFolders(path)).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("no longer available"),
    });
});

test.skipIf(process.getuid?.() === 0)(
  "permission errors are recoverable and do not prevent browsing siblings",
  async () => {
    const locked = join(root, "locked");
    await mkdir(locked);
    await chmod(locked, 0);
    try {
      expect((await listFolders(root)).directories).toContainEqual({
        name: "locked",
        path: locked,
      });
      await expect(listFolders(locked)).rejects.toMatchObject({
        status: 403,
        message:
          "Permission denied. Check folder access for the account running Nerilo on this project's machine, or choose another folder.",
      });
    } finally {
      await chmod(locked, 0o700);
    }
    expect((await listFolders(locked)).directories).toEqual([]);
  },
);
