import { test, expect } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "./engine";
import { Store } from "../platform/store";
import { checked } from "../platform/config";

async function withEngine(
  callback: (engine: Engine, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "nerilo-validation-"));
  const store = new Store(join(root, "store.sqlite"));
  try {
    await callback(new Engine(store, true), root);
  } finally {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
}

test("validates a repository and returns its canonical root and branch", () =>
  withEngine(async (engine, root) => {
    const repository = join(root, "repository");
    await checked(["git", "init", repository]);
    await checked(["git", "-C", repository, "branch", "-M", "main"]);
    await checked(["git", "-C", repository, "config", "user.name", "Fixture"]);
    await checked([
      "git",
      "-C",
      repository,
      "config",
      "user.email",
      "fixture@example.test",
    ]);
    await writeFile(join(repository, "README.md"), "# Fixture\n");
    await checked(["git", "-C", repository, "add", "."]);
    await checked(["git", "-C", repository, "commit", "-m", "Initial"]);

    await expect(engine.validateProject(repository)).resolves.toEqual({
      path: await realpath(repository),
      branch: "main",
    });
  }));

test("rejects a missing project folder with an actionable error", () =>
  withEngine(async (engine, root) => {
    await expect(engine.validateProject(join(root, "missing"))).rejects.toThrow(
      "Choose an existing project folder.",
    );
  }));

test("rejects a non-repository with an actionable error", () =>
  withEngine(async (engine, root) => {
    const folder = join(root, "folder");
    await mkdir(folder);
    await expect(engine.validateProject(folder)).rejects.toThrow(
      "Choose a Git repository.",
    );
  }));

test("rejects a nested repository folder", () =>
  withEngine(async (engine, root) => {
    const repository = join(root, "repository");
    await checked(["git", "init", repository]);
    const nested = join(repository, "nested");
    await mkdir(nested);
    await expect(engine.validateProject(nested)).rejects.toThrow(
      "Choose the repository root folder.",
    );
  }));

test("rejects an empty Git repository with an actionable error", () =>
  withEngine(async (engine, root) => {
    const repository = join(root, "repository");
    await checked(["git", "init", repository]);
    await expect(engine.validateProject(repository)).rejects.toThrow(
      "Create an initial commit in this repository.",
    );
  }));
