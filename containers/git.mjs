import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { run } from "./process.mjs";

/** Capture one consistent tree without modifying the workspace or its index. */
export async function captureWorkspace(base, cwd = "/work/repo") {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-result-"));
  const git = async (args, env = {}) => {
    const result = await run(["git", "-c", "core.fsmonitor=false", ...args], {
      cwd,
      env,
    });
    if (result.code !== 0)
      throw new Error(
        `Could not capture workspace changes: ${result.err || result.out || args[0]}`,
      );
    return result;
  };
  try {
    const headCommit = (
      await git(["rev-parse", "--verify", "HEAD^{commit}"])
    ).out.trim();
    const objects = (
      await git(["rev-parse", "--git-path", "objects"])
    ).out.trim();
    const objectDirectory = join(directory, "objects");
    await mkdir(objectDirectory);
    const env = {
      GIT_INDEX_FILE: join(directory, "index"),
      GIT_OBJECT_DIRECTORY: objectDirectory,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: resolve(cwd, objects),
    };
    await git(["read-tree", "HEAD"], env);
    await git(["add", "-A", "--", "."], env);
    const tree = (await git(["write-tree"], env)).out.trim();
    const diff = await git(
      ["diff", "--binary", "--no-ext-diff", "--no-textconv", base, tree, "--"],
      env,
    );
    const stats = await git(
      ["diff", "--numstat", "--no-renames", "-z", base, tree, "--"],
      env,
    );
    const changes = stats.truncated
      ? []
      : stats.out
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(line);
            if (!match)
              throw new Error("Git returned invalid file statistics.");
            return {
              path: match[3],
              status: "changed",
              additions: Number(match[1]) || 0,
              deletions: Number(match[2]) || 0,
            };
          });
    return {
      diff: diff.out,
      changes,
      headCommit,
      truncated: diff.truncated || stats.truncated,
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
