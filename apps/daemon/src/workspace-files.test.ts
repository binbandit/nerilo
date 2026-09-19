import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  workspaceFilesSchema,
  workspaceFileSchema,
  workspacePathSchema,
} from "@nerilo/protocol";
import { checked } from "./config";
import { workspaceReader } from "./workspace-files";

async function withWorkspace(
  run: (
    work: string,
    read: (mode: "list" | "file", path?: string) => Promise<unknown>,
  ) => Promise<void>,
) {
  const work = await mkdtemp(join(tmpdir(), "nerilo-files-"));
  const repo = join(work, "repo");
  await mkdir(repo);
  await checked(["git", "init", repo]);
  const read = async (mode: "list" | "file", path = "") => {
    const output = await checked([
      "python3",
      "-c",
      workspaceReader.replace("os.open('/work',", "os.open(sys.argv[3],"),
      mode,
      path,
      work,
    ]);
    return JSON.parse(output) as unknown;
  };
  try {
    await run(work, read);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

test("workspace paths reject traversal, Git internals and invisible characters", () => {
  for (const path of [
    "",
    "/etc/passwd",
    "../secret",
    "src/../../secret",
    "./readme",
    "a//b",
    ".git/config",
    "a/.git/config",
    "a\0b",
    "line\nbreak",
    "a".repeat(2001),
  ])
    expect(workspacePathSchema.safeParse(path).success).toBe(false);
  expect(workspacePathSchema.parse("src/hello world.ts")).toBe(
    "src/hello world.ts",
  );
});

test("lists tracked and untracked files, omitting ignored, deleted and symlink files", () =>
  withWorkspace(async (work, read) => {
    const repo = join(work, "repo");
    await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
    await writeFile(join(repo, "tracked.txt"), "tracked");
    await writeFile(join(repo, "deleted.txt"), "deleted");
    await checked(["git", "-C", repo, "add", "."]);
    await rm(join(repo, "deleted.txt"));
    await writeFile(join(repo, "untracked.txt"), "new");
    await writeFile(join(repo, "ignored.txt"), "ignored");
    await symlink("tracked.txt", join(repo, "link.txt"));
    expect(workspaceFilesSchema.parse(await read("list"))).toEqual({
      files: [".gitignore", "tracked.txt", "untracked.txt"],
      truncated: false,
    });
  }));

test("previews regular content but refuses both file and directory symlinks", () =>
  withWorkspace(async (work, read) => {
    const repo = join(work, "repo");
    await writeFile(join(repo, "readme.txt"), "hello\n");
    await mkdir(join(work, "outside"));
    await writeFile(join(work, "outside", "private.txt"), "private");
    await symlink("../outside", join(repo, "linked"));
    await symlink("../outside/private.txt", join(repo, "linked.txt"));
    expect(workspaceFileSchema.parse(await read("file", "readme.txt"))).toEqual(
      {
        path: "readme.txt",
        content: "hello\n",
        image: null,
      },
    );
    for (const path of [
      "linked/private.txt",
      "linked.txt",
      ".git/config",
      "../outside/private.txt",
      "missing.txt",
    ])
      expect(await read("file", path)).toHaveProperty("error");
  }));

test("previews PNG and JPEG while rejecting binary and oversized content", () =>
  withWorkspace(async (work, read) => {
    const repo = join(work, "repo");
    await writeFile(
      join(repo, "image.png"),
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    await writeFile(join(repo, "image.jpg"), Buffer.from([255, 216, 255]));
    await writeFile(join(repo, "binary.dat"), Buffer.from([0, 1, 2]));
    await writeFile(join(repo, "huge.txt"), Buffer.alloc(2000001, 97));
    expect(
      workspaceFileSchema.parse(await read("file", "image.png")).image,
    ).toStartWith("data:image/png;base64,");
    expect(
      workspaceFileSchema.parse(await read("file", "image.jpg")).image,
    ).toStartWith("data:image/jpeg;base64,");
    expect(await read("file", "binary.dat")).toEqual({
      error: "This binary file cannot be previewed as text.",
    });
    expect(await read("file", "huge.txt")).toEqual({
      error: "This file is too large for the preview (2 MB limit).",
    });
  }));

test("large file lists are bounded and report truncation", () =>
  withWorkspace(async (work, read) => {
    const repo = join(work, "repo");
    await checked([
      "python3",
      "-c",
      "import pathlib,sys\np=pathlib.Path(sys.argv[1])\nfor i in range(10001): (p / ('file-%05d.txt' % i)).touch()",
      repo,
    ]);
    const result = workspaceFilesSchema.parse(await read("list"));
    expect(result.files).toHaveLength(10000);
    expect(result.truncated).toBe(true);
  }));

test("Git file listing cannot launch a configured fsmonitor command", () =>
  withWorkspace(async (work, read) => {
    const repo = join(work, "repo");
    await writeFile(join(repo, "readme.txt"), "hello");
    await checked(["git", "-C", repo, "add", "."]);
    await checked([
      "git",
      "-C",
      repo,
      "config",
      "core.fsmonitor",
      `touch ${join(work, "unexpected-fsmonitor")}`,
    ]);
    expect(workspaceFilesSchema.parse(await read("list"))).toEqual({
      files: ["readme.txt"],
      truncated: false,
    });
    expect(
      await lstat(join(work, "unexpected-fsmonitor")).catch(() => null),
    ).toBeNull();
  }));

test("a replaced repository root cannot redirect previews outside the workspace", () =>
  withWorkspace(async (work, read) => {
    await mkdir(join(work, "outside"));
    await writeFile(join(work, "outside", "private.txt"), "private");
    await rm(join(work, "repo"), { recursive: true });
    await symlink("outside", join(work, "repo"));
    expect(await read("list")).toHaveProperty("error");
    expect(await read("file", "private.txt")).toHaveProperty("error");
  }));
