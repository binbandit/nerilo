import { readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import type { FolderListing } from "@nerilo/protocol";
import { command } from "../platform/config";

export class FolderError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

function unavailable(error: unknown): never {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === "EACCES" || code === "EPERM")
    throw new FolderError(
      "Permission denied. Check folder access for the account running Nerilo on this project's machine, or choose another folder.",
      403,
    );
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP")
    throw new FolderError(
      "This folder is no longer available. Choose another folder or retry.",
      404,
    );
  throw error;
}

export async function listFolders(input?: string): Promise<FolderListing> {
  if (
    input !== undefined &&
    (!isAbsolute(input) || input.length > 2000 || /[\x00-\x1f\x7f]/.test(input))
  )
    throw new FolderError("Choose an absolute folder path.", 400);

  let path: string;
  let entries;
  try {
    path = await realpath(input ?? homedir());
    entries = await readdir(path, { withFileTypes: true });
  } catch (error) {
    return unavailable(error);
  }

  const directories: FolderListing["directories"] = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory())
      directories.push({ name: entry.name, path: child });
    else if (entry.isSymbolicLink()) {
      try {
        const target = await realpath(child);
        if ((await stat(target)).isDirectory())
          directories.push({ name: entry.name, path: target });
      } catch {
        // A broken or inaccessible link must not prevent browsing its siblings.
      }
    }
  }
  directories.sort((a, b) => a.name.localeCompare(b.name));

  const git = (...args: string[]) =>
    command(["git", "-C", path, "rev-parse", ...args], { timeout: 5000 });
  const root = await git("--show-toplevel");
  let reason: string | null = "Choose a Git repository.";
  if (root.code === 0) {
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(root.stdout.trim());
    } catch (error) {
      return unavailable(error);
    }
    reason =
      canonicalRoot !== path
        ? "Choose the repository root folder."
        : (await git("--verify", "HEAD^{commit}")).code !== 0
          ? "This repository needs at least one commit."
          : null;
  }
  const parent = dirname(path);
  return {
    path,
    parent: parent === path ? null : parent,
    directories,
    selectable: reason === null,
    reason,
  };
}
