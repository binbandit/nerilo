import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gitRemoteStatusSchema } from "@nerilo/protocol";
import { checked } from "../platform/config";
import { compareGitRemote } from "./git-remote-status";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-remote-status-"));
  const remote = join(directory, "remote.git");
  const path = join(directory, "checkout");
  const writer = join(directory, "writer");
  await checked(["git", "init", "--bare", "-b", "main", remote]);
  await checked(["git", "clone", remote, path]);
  const git = ["git", "-C", path];
  await Bun.write(join(path, "file.txt"), "Original\n");
  const commit = async (location: string, title: string) => {
    await checked(["git", "-C", location, "add", "."]);
    await checked([
      "git",
      "-C",
      location,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgsign=false",
      "commit",
      "--allow-empty",
      "-m",
      title,
    ]);
    return checked(["git", "-C", location, "rev-parse", "HEAD"]);
  };
  await commit(path, "Initial");
  await checked([...git, "push", "origin", "main"]);
  await checked([...git, "switch", "-c", "nerilo/task"]);
  await checked(["git", "clone", remote, writer]);
  await checked(["git", "-C", writer, "switch", "-c", "nerilo/task"]);
  const head = await checked([...git, "rev-parse", "HEAD"]);
  const compare = async (network = { checked }) =>
    gitRemoteStatusSchema.parse(
      await compareGitRemote(
        {
          path,
          remote,
          branch: "nerilo/task",
          head: await checked([...git, "rev-parse", "HEAD"]),
        },
        network,
      ),
    );
  return {
    remote,
    path,
    writer,
    git,
    head,
    commit,
    compare,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("remote comparison distinguishes unpublished, synced, ahead, behind and diverged branches", async () => {
  const f = await fixture();
  try {
    expect(await f.compare()).toMatchObject({
      state: "unpublished",
      remoteHead: null,
      ahead: null,
      behind: null,
      error: null,
    });
    await checked([...f.git, "push", "origin", "nerilo/task"]);
    expect(await f.compare()).toMatchObject({
      state: "synced",
      head: f.head,
      remoteHead: f.head,
      ahead: 0,
      behind: 0,
    });
    const remoteHead = await f.commit(f.writer, "Remote improvement");
    await checked(["git", "-C", f.writer, "push", "origin", "nerilo/task"]);
    expect(await f.compare()).toMatchObject({
      state: "behind",
      head: f.head,
      remoteHead,
      ahead: 0,
      behind: 1,
    });
    const localHead = await f.commit(f.path, "Local improvement");
    expect(await f.compare()).toMatchObject({
      state: "diverged",
      head: localHead,
      remoteHead,
      ahead: 1,
      behind: 1,
    });
    await checked([
      "git",
      "--git-dir",
      f.remote,
      "update-ref",
      "refs/heads/nerilo/task",
      f.head,
    ]);
    expect(await f.compare()).toMatchObject({
      state: "ahead",
      head: localHead,
      remoteHead: f.head,
      ahead: 1,
      behind: 0,
    });
  } finally {
    await f.cleanup();
  }
});

test("fetching missing remote history preserves staging, worktree, branches and FETCH_HEAD", async () => {
  const f = await fixture();
  try {
    const remoteHead = await f.commit(f.writer, "New remote commit");
    await checked(["git", "-C", f.writer, "push", "origin", "nerilo/task"]);
    await Bun.write(join(f.path, "file.txt"), "Staged change\n");
    await checked([...f.git, "add", "file.txt"]);
    await Bun.write(join(f.path, "file.txt"), "Unstaged change\n");
    await Bun.write(join(f.path, "new.txt"), "Untracked\n");
    await Bun.write(join(f.path, ".git", "FETCH_HEAD"), "untouched\n");
    const index = await readFile(join(f.path, ".git", "index"));
    const refs = await checked([...f.git, "show-ref"]);
    const status = await checked([...f.git, "status", "--porcelain"]);
    const calls: string[][] = [];
    expect(
      await f.compare({
        checked: async (args, options) => {
          calls.push(args);
          return checked(args, options);
        },
      }),
    ).toMatchObject({ state: "behind", remoteHead, behind: 1 });
    expect(calls.filter((args) => args.includes("fetch"))).toHaveLength(1);
    expect(await readFile(join(f.path, ".git", "index"))).toEqual(index);
    expect(await checked([...f.git, "show-ref"])).toBe(refs);
    expect(await checked([...f.git, "status", "--porcelain"])).toBe(status);
    expect(await Bun.file(join(f.path, ".git", "FETCH_HEAD")).text()).toBe(
      "untouched\n",
    );
    expect(await Bun.file(join(f.path, "file.txt")).text()).toBe(
      "Unstaged change\n",
    );
    expect(await Bun.file(join(f.path, "new.txt")).text()).toBe("Untracked\n");
    expect(await checked([...f.git, "rev-parse", "HEAD"])).toBe(f.head);
    expect(await checked([...f.git, "symbolic-ref", "--short", "HEAD"])).toBe(
      "nerilo/task",
    );
  } finally {
    await f.cleanup();
  }
});

test("network errors and malformed responses are unavailable, never unpublished", async () => {
  const f = await fixture();
  try {
    for (const network of [
      {
        checked: async () => {
          throw new Error("Authentication failed: secret");
        },
      },
      { checked: async () => "not a Git ref" },
      { checked: async () => `${f.head}\trefs/heads/another-branch` },
    ]) {
      const status = await f.compare(network);
      expect(status).toMatchObject({
        state: "unavailable",
        ahead: null,
        behind: null,
      });
      expect(status.error).not.toContain("secret");
    }
    const remoteHead = await f.commit(f.writer, "Remote commit");
    await checked(["git", "-C", f.writer, "push", "origin", "nerilo/task"]);
    const failedFetch = await f.compare({
      checked: async (args, options) => {
        if (args.includes("fetch")) throw new Error("Network unavailable");
        return checked(args, options);
      },
    });
    expect(failedFetch.state).toBe("unavailable");
    expect(failedFetch.remoteHead).toBeNull();
    expect(await checked([...f.git, "rev-parse", "HEAD"])).not.toBe(remoteHead);
  } finally {
    await f.cleanup();
  }
});

test("remote or local movement during comparison invalidates the captured result", async () => {
  const f = await fixture();
  try {
    let reads = 0;
    const remoteMoved = await f.compare({
      checked: async () => {
        reads += 1;
        return reads === 1 ? "" : `${f.head}\trefs/heads/nerilo/task`;
      },
    });
    expect(remoteMoved.state).toBe("unavailable");
    expect(remoteMoved.error).toContain("remote branch changed");
    const localMoved = await f.compare({
      checked: async (args, options) => {
        await f.commit(f.path, "Concurrent local commit");
        return checked(args, options);
      },
    });
    expect(localMoved.head).toBe(f.head);
    expect(localMoved.state).toBe("unavailable");
    expect(localMoved.error).toContain("checkout changed");
    const head = await checked([...f.git, "rev-parse", "HEAD"]);
    const branchMoved = await f.compare({
      checked: async (args, options) => {
        await checked([...f.git, "switch", "main"]);
        return checked(args, options);
      },
    });
    expect(branchMoved).toMatchObject({
      head,
      branch: "nerilo/task",
      state: "unavailable",
    });
  } finally {
    await f.cleanup();
  }
});
