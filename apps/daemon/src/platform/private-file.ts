import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

/** Replace private data atomically so readers never observe partial JSON. */
export function writePrivateFile(path: string, content: string) {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, content, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Read a private regular file, atomically initializing it when absent. */
export function readPrivateFile(path: string, create: () => string) {
  let descriptor: number;
  try {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    )
      throw error;
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, create(), {
        mode: 0o600,
        flag: "wx",
      });
      try {
        // Publish the complete file without replacing a concurrent initializer.
        linkSync(temporary, path);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        )
          throw error;
      }
    } finally {
      rmSync(temporary, { force: true });
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
  }
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile())
      throw new Error("Private data must be stored in a regular file.");
    if (stats.size > 8192)
      throw new Error("The private data file exceeds the 8 KB limit.");
    fchmodSync(descriptor, 0o600);
    return readFileSync(descriptor, "utf8");
  } finally {
    closeSync(descriptor);
  }
}
