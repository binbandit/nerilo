import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Tests must never initialize credentials or exports in the user's real data directory.
const directory = mkdtempSync(join(tmpdir(), "nerilo-tests-"));
process.env.NERILO_DATA_DIR = directory;
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
