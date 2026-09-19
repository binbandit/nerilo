import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, relative, isAbsolute, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  activeStatuses,
  type Task,
  type Project,
  type GitStatus,
  type GitAction,
} from "@nerilo/protocol";
import { checked, command, dataDir } from "./config";
import { projectRepository, readPullRequest } from "./pull-requests";
import type { Store } from "./store";
import { captureRepositoryAction } from "./repository-history";
import { compareGitRemote, unavailableRemoteStatus } from "./git-remote-status";

const locks = new Set<string>();
export async function validateBranch(branch: string) {
  if (
    branch.startsWith("-") ||
    branch === "HEAD" ||
    branch.includes("@{") ||
    /[\r\n]/.test(branch)
  )
    throw new Error("Choose a valid branch name.");
  const result = await command(["git", "check-ref-format", "--branch", branch]);
  if (result.code)
    throw new Error(
      "Choose a valid branch name, such as nerilo/improve-validation.",
    );
}

async function context(store: Store, id: string, expectedTurn?: string) {
  const task = store.get("task", id);
  if (!task) throw new Error("Task not found.");
  if (
    task.activeTurnId ||
    task.pending.length ||
    activeStatuses.includes(task.status)
  )
    throw new Error("Finish or pause queued work before using Git.");
  const turn = store
    .all("turn")
    .filter((value) => value.taskId === id)
    .at(-1);
  if (
    !task.checkout ||
    !turn?.result ||
    task.checkout.turnId !== turn.id ||
    (expectedTurn && expectedTurn !== turn.id)
  )
    throw new Error("Create a checkout of the latest result before using Git.");
  const project = store.get("project", task.projectId);
  if (!project) throw new Error("Project not found.");
  const path = await realpath(task.checkout.path);
  const root = await realpath(join(dataDir, "checkouts"));
  const location = relative(root, path);
  if (
    !location ||
    location.startsWith("..") ||
    isAbsolute(location) ||
    path !==
      join(
        root,
        relative(resolve(dataDir, "checkouts"), resolve(task.checkout.path)),
      )
  )
    throw new Error("Git actions require a Nerilo-managed checkout.");
  if (
    (await checked(["git", "-C", path, "rev-parse", "--show-toplevel"])) !==
    path
  )
    throw new Error("The checkout is no longer a repository root.");
  const gitDirectory = await realpath(
    await checked(["git", "-C", path, "rev-parse", "--absolute-git-dir"]),
  );
  if (gitDirectory !== join(path, ".git"))
    throw new Error("Git actions require the checkout's own Git directory.");
  if (
    [
      "MERGE_HEAD",
      "CHERRY_PICK_HEAD",
      "REVERT_HEAD",
      "REBASE_HEAD",
      "rebase-merge",
      "rebase-apply",
      "sequencer",
    ].some((name) => existsSync(join(gitDirectory, name)))
  )
    throw new Error(
      "Finish or abort the Git operation in this checkout before continuing.",
    );
  if (await checked(["git", "-C", path, "ls-files", "--unmerged"]))
    throw new Error(
      "Resolve the checkout's merge conflicts before continuing.",
    );
  return { task, project, turn, path };
}

// A separate index captures new files as well as edits without changing staging.
async function review(path: string) {
  const directory = await mkdtemp(join(tmpdir(), "nerilo-git-review-"));
  const env = { GIT_INDEX_FILE: join(directory, "index") };
  const git = ["git", "-C", path];
  try {
    const head = await checked([...git, "rev-parse", "HEAD"]);
    const branch = await checked([...git, "symbolic-ref", "--short", "HEAD"]);
    await checked([...git, "read-tree", "HEAD"], { env });
    await checked([...git, "add", "-A", "--", "."], { env });
    const tree = await checked([...git, "write-tree"], { env });
    const files = await checked([
      ...git,
      "diff",
      "--name-status",
      head,
      tree,
      "--",
    ]);
    const patch = await checked([
      ...git,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      head,
      tree,
      "--",
    ]);
    return {
      head,
      branch,
      tree,
      files,
      patch,
      reviewToken: createHash("sha256")
        .update(`${head}\n${branch}\n${tree}`)
        .digest("hex"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function suggestions(task: Task, project: Project, summary: string) {
  const title = task.title.replace(/[\r\n]+/g, " ").slice(0, 160);
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 65) || "task";
  return {
    branch: `nerilo/${slug}-${task.id.slice(0, 8)}`,
    commitTitle: title,
    prTitle: title,
    prBody: `${summary.slice(0, 10000)}${project.verify ? `\n\nValidation command: \`${project.verify}\`` : ""}`,
  };
}

async function publishBlock(path: string, repository: string | null) {
  if (!repository) return "Add a GitHub origin to the project to publish.";
  const snapshots = await checked([
    "git",
    "-C",
    path,
    "log",
    "--format=%H",
    "--author=snapshot@nerilo.local",
    "HEAD",
  ]);
  if (snapshots)
    return "This task includes a local working snapshot. Commit the source project and start a new task from that commit before publishing.";
  return null;
}

export async function gitStatus(store: Store, id: string): Promise<GitStatus> {
  const { task, project, turn, path } = await context(store, id);
  const state = await review(path);
  const repository = await projectRepository(project);
  const base = task.source?.baseCommit ?? turn.result!.baseCommit;
  const commits = Number(
    await checked(["git", "-C", path, "rev-list", "--count", `${base}..HEAD`]),
  );
  const patch = state.files
    ? state.patch
    : await checked([
        "git",
        "-C",
        path,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        base,
        "HEAD",
        "--",
      ]);
  return {
    path,
    turnId: turn.id,
    branch: state.branch,
    baseBranch: project.branch,
    head: state.head,
    reviewToken: state.reviewToken,
    dirty: Boolean(state.files),
    files: state.files,
    patch: patch.slice(0, 100000),
    truncated: patch.length > 100000,
    commits,
    repository,
    publishBlocked: await publishBlock(path, repository),
    draft: suggestions(task, project, turn.result!.summary),
  };
}

export async function gitRemoteStatus(
  store: Store,
  id: string,
  network = { checked },
) {
  const { project, path, turn } = await context(store, id);
  const head = await checked(["git", "-C", path, "rev-parse", "HEAD"]);
  const branch = await checked([
    "git",
    "-C",
    path,
    "symbolic-ref",
    "--short",
    "HEAD",
  ]);
  const local = { path, head, branch };
  const repository = await projectRepository(project);
  if (!repository)
    return unavailableRemoteStatus(
      local,
      "Add a GitHub repository to the project to compare this branch.",
    );
  const status = await compareGitRemote(
    { ...local, remote: `https://github.com/${repository}.git` },
    network,
  );
  try {
    const fresh = await context(store, id, turn.id);
    if (
      fresh.path !== path ||
      (await projectRepository(fresh.project)) !== repository ||
      (await checked(["git", "-C", path, "rev-parse", "HEAD"])) !== head ||
      (await checked([
        "git",
        "-C",
        path,
        "symbolic-ref",
        "--short",
        "HEAD",
      ])) !== branch
    )
      throw new Error("Checkout changed.");
  } catch {
    return unavailableRemoteStatus(
      local,
      "The task changed. Refresh and try again.",
    );
  }
  return status;
}

export async function gitAction(
  store: Store,
  id: string,
  input: GitAction,
  network = { checked, readPullRequest },
) {
  if (locks.has(id)) throw new Error("A Git action is already running.");
  locks.add(id);
  try {
    const { task, project, turn, path } = await context(
      store,
      id,
      input.turnId,
    );
    const state = await review(path);
    if (state.reviewToken !== input.reviewToken)
      throw new Error(
        "The checkout changed. Refresh and review it before continuing.",
      );
    const git = ["git", "-C", path];
    const ensureCurrent = async () => {
      const current = await context(store, id, input.turnId);
      if (
        current.path !== path ||
        (await review(path)).reviewToken !== input.reviewToken
      )
        throw new Error(
          "The checkout changed. Refresh and review it before continuing.",
        );
    };
    if (input.action === "branch") {
      await validateBranch(input.branch);
      await ensureCurrent();
      await checked([...git, "switch", "-c", input.branch]);
      captureRepositoryAction(
        store,
        id,
        {
          id: `branch:${input.branch}:${state.head}`,
          kind: "branch",
          summary: `Created branch ${input.branch}`,
          headSha: state.head,
        },
        input.turnId,
      );
    } else if (input.action === "commit") {
      if (!state.files) throw new Error("There are no changes to commit.");
      // Identity comes from the user's source project, including repository-local configuration.
      const identityGit = project.path
        ? ["git", "-C", project.path, "config"]
        : ["git", "config", "--global"];
      const name = await checked([...identityGit, "user.name"]);
      const email = await checked([...identityGit, "user.email"]);
      await ensureCurrent();
      const commit = await checked(
        [
          ...git,
          "-c",
          `user.name=${name}`,
          "-c",
          `user.email=${email}`,
          "commit-tree",
          state.tree,
          "-p",
          state.head,
          "-F",
          "-",
        ],
        { input: input.message },
      );
      await checked([
        ...git,
        "update-ref",
        `refs/heads/${state.branch}`,
        commit,
        state.head,
      ]);
      await checked([...git, "reset", "--mixed", commit]);
      captureRepositoryAction(
        store,
        id,
        {
          id: `commit:${commit}`,
          kind: "commit",
          summary: input.message.split("\n")[0].slice(0, 500),
          headSha: commit,
        },
        input.turnId,
      );
    } else {
      if (state.files)
        throw new Error("Commit the checkout changes before publishing.");
      const base = task.source?.baseCommit ?? turn.result!.baseCommit;
      const commits = Number(
        await checked([
          ...git,
          "rev-list",
          "--count",
          `${base}..${state.head}`,
        ]),
      );
      if (commits < 1)
        throw new Error("Create a commit before publishing this task.");
      const repository = await projectRepository(project);
      const blocked = await publishBlock(path, repository);
      if (blocked || !repository)
        throw new Error(blocked ?? "A GitHub repository is required.");
      const defaultBranch = await network.checked([
        "gh",
        "repo",
        "view",
        repository,
        "--json",
        "defaultBranchRef",
        "--jq",
        ".defaultBranchRef.name",
      ]);
      if ([defaultBranch, "main", "master"].includes(state.branch))
        throw new Error("Create a task branch before publishing.");
      const remote = `https://github.com/${repository}.git`;
      const networkGit = [
        ...git,
        "-c",
        "credential.helper=",
        "-c",
        "credential.helper=!gh auth git-credential",
      ];
      if (input.action === "push") {
        await ensureCurrent();
        await network.checked(
          [
            ...networkGit,
            "push",
            "--porcelain",
            remote,
            `${state.head}:refs/heads/${state.branch}`,
          ],
          { timeout: 60000 },
        );
        captureRepositoryAction(
          store,
          id,
          {
            id: `published:${state.head}`,
            kind: "published",
            summary: `Pushed ${state.branch}`,
            headSha: state.head,
            url: `https://github.com/${repository}/commit/${state.head}`,
          },
          input.turnId,
        );
      } else {
        await validateBranch(input.base);
        if (input.base === state.branch)
          throw new Error("Choose a different base branch.");
        if (task.pullRequests.length >= 8)
          throw new Error("A task can link up to 8 pull requests.");
        const remoteHead = await network.checked([
          ...networkGit,
          "ls-remote",
          "--heads",
          remote,
          `refs/heads/${state.branch}`,
        ]);
        if (remoteHead.split(/\s/)[0] !== state.head)
          throw new Error("Push this branch before opening a pull request.");
        const existing = await network.checked([
          "gh",
          "pr",
          "list",
          "--repo",
          repository,
          "--head",
          state.branch,
          "--base",
          input.base,
          "--state",
          "open",
          "--json",
          "url",
          "--jq",
          ".[0].url // empty",
        ]);
        let url = existing;
        if (!url) {
          await ensureCurrent();
          const directory = await mkdtemp(join(tmpdir(), "nerilo-pr-"));
          try {
            const bodyFile = join(directory, "body.md");
            await Bun.write(bodyFile, input.body);
            url = await network.checked(
              [
                "gh",
                "pr",
                "create",
                "--repo",
                repository,
                "--head",
                state.branch,
                "--base",
                input.base,
                "--title",
                input.title,
                "--body-file",
                bodyFile,
              ],
              { timeout: 60000 },
            );
          } finally {
            await rm(directory, { recursive: true, force: true });
          }
        }
        const pr = await network.readPullRequest(url.trim());
        captureRepositoryAction(
          store,
          id,
          {
            id: `pr-linked:${pr.url}`,
            kind: "pr-opened",
            summary: `Pull request #${pr.number} opened`,
            url: pr.url,
            prUrl: pr.url,
            timeSource: "observed",
          },
          input.turnId,
        );
        const fresh = store.get("task", id)!;
        store.put("task", id, {
          ...fresh,
          pullRequests: [
            ...fresh.pullRequests.filter((value) => value.url !== pr.url),
            pr,
          ],
        });
      }
    }
    store.event({
      taskId: id,
      turnId: input.turnId,
      kind: "system",
      text: {
        branch: "Created a local branch.",
        commit: "Committed the reviewed checkout changes.",
        push: "Pushed the task branch.",
        "pull-request": "Opened the task pull request.",
      }[input.action],
    });
    return gitStatus(store, id);
  } finally {
    locks.delete(id);
  }
}
