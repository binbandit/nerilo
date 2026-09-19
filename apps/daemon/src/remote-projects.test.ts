import { test, expect } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checked } from "./config";
import { remoteRepository, readRemoteProject } from "./remote-projects";
import { bundleRevision } from "./revision-bundle";
import { projectSchema } from "@nerilo/protocol";
import { projectRepository } from "./pull-requests";

test("GitHub projects resolve canonical repositories and pin the default branch without a local folder", async () => {
  const head = "a".repeat(40);
  const calls: string[][] = [];
  const project = await readRemoteProject(
    "https://github.com/example/project.git",
    async (args) => {
      calls.push(args);
      return args[0] === "gh"
        ? JSON.stringify({
            nameWithOwner: "Example/Project",
            defaultBranchRef: { name: "develop" },
            isEmpty: false,
          })
        : `${head}\trefs/heads/develop\n`;
    },
  );
  expect(project).toEqual({
    path: "",
    repository: "Example/Project",
    branch: "develop",
    headCommit: head,
  });
  expect(calls[1]).toContain("credential.helper=!gh auth git-credential");
  expect(calls[1]).toContain("https://github.com/Example/Project.git");
  const selected = await readRemoteProject(
    "example/project",
    async (args) =>
      args[0] === "gh"
        ? JSON.stringify({
            nameWithOwner: "example/project",
            defaultBranchRef: { name: "main" },
            isEmpty: false,
          })
        : `${head}\trefs/heads/nerilo/lifecycle-base\n`,
    "nerilo/lifecycle-base",
  );
  expect(selected.branch).toBe("nerilo/lifecycle-base");
  expect(selected.headCommit).toBe(head);
  expect(
    await projectRepository(
      projectSchema.parse({
        ...project,
        id: "project",
        name: "Project",
        createdAt: "now",
      }),
    ),
  ).toBe("Example/Project");
  await expect(
    readRemoteProject("example/empty", async () =>
      JSON.stringify({
        nameWithOwner: "example/empty",
        defaultBranchRef: null,
        isEmpty: true,
      }),
    ),
  ).rejects.toThrow("initial commit");
  for (const value of [
    "https://github.com.evil.test/owner/repo",
    "https://user:token@github.com/owner/repo",
    "../repo",
    "--help",
    "https://github.com/owner/repo/issues",
  ])
    expect(() => remoteRepository(value)).toThrow();
});

test("remote task bundles need only a bare repository and retain the pinned revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerilo-remote-project-"));
  try {
    const remote = join(root, "remote.git");
    await checked(["git", "init", "--bare", remote]);
    const git = ["git", "-C", remote];
    const blob = await checked([...git, "hash-object", "-w", "--stdin"], {
      input: "Remote source\n",
    });
    const tree = await checked([...git, "mktree"], {
      input: `100644 blob ${blob}\tREADME.md\n`,
    });
    const commit = await checked([
      ...git,
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit-tree",
      tree,
      "-m",
      "Initial source",
    ]);
    await checked([...git, "update-ref", "refs/heads/main", commit]);
    await checked([...git, "symbolic-ref", "HEAD", "refs/heads/main"]);
    const snapshot = join(root, "snapshot");
    await mkdir(snapshot);
    await bundleRevision(
      remote,
      { headCommit: commit, baseCommit: commit },
      snapshot,
    );
    expect(await checked([...git, "rev-parse", "--is-bare-repository"])).toBe(
      "true",
    );
    expect(await Bun.file(join(remote, "README.md")).exists()).toBe(false);
    const workspace = join(root, "agent-workspace");
    await checked([
      "git",
      "clone",
      "--",
      join(snapshot, "source.bundle"),
      workspace,
    ]);
    expect(await checked(["git", "-C", workspace, "rev-parse", "HEAD"])).toBe(
      commit,
    );
    expect(await Bun.file(join(workspace, "README.md")).text()).toBe(
      "Remote source\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
