import { z } from "zod";
import { withTaskGithubAccount } from "../git/github-context";
import { join } from "node:path";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import {
  autonomySchema,
  autonomyModeSchema,
  autopilotPromptPrefix,
  type RunResult,
  type Task,
} from "@nerilo/protocol";
import type { Store } from "../platform/store";
import type { Engine } from "./engine";
import { checked, command, dataDir, imageTag, now } from "../platform/config";
import { projectRepository, readPullRequest } from "../git/pull-requests";
import { gitStatus, validateBranch } from "../git/git-workflows";
import {
  readPublicationTarget,
  requireSameRepositoryPR,
} from "../git/pr-publication";
import { generateGitDraft } from "../agents/ai-suggestions";
import {
  observePullRequest,
  validateMergeCapability,
  type PullRequestObservation,
} from "../git/pr-observer";
import { withTaskLock, isTaskLocked } from "./task-locks";
import { requireAvailableProject } from "../projects/project-lifecycle";
import { createHash } from "node:crypto";
import {
  captureObservation,
  captureRepositoryAction,
  repairOrigin,
} from "../git/repository-history";
import { refreshStateSummary } from "./state-summary";

const summaryFixtures = new WeakMap<Store, boolean>();

const defaultIO = {
  remote: checked,
  remoteResult: command,
  draft: generateGitDraft,
  readPR: readPullRequest,
  observe: observePullRequest,
  mergeCapability: validateMergeCapability,
};
type AutonomyIO = typeof defaultIO;

const cursorSchema = z.object({
  version: z.literal(1),
  seenEventIds: z.array(z.string()),
  headSha: z.string(),
  baseSha: z.string(),
  behindSince: z.string().nullable(),
  pendingSince: z.string().nullable(),
});
const savedSchema = autonomySchema.extend({
  publication: z
    .object({
      turnId: z.string(),
      path: z.string(),
      head: z.string(),
      previousHead: z.string().nullable(),
      rebased: z.boolean(),
      stage: z.enum(["prepared", "pushed"]),
      prTitle: z.string(),
      prBody: z.string(),
      summary: z.string(),
    })
    .nullable()
    .default(null),
  repository: z.string(),
  workingPath: z.string().nullable(),
  publishedHead: z.string().nullable(),
  processedTurnId: z.string().nullable(),
  cursor: cursorSchema.nullable(),
  ignoredEventIds: z.array(z.string()),
  awaitingReply: z.array(z.string()),
  rebaseTarget: z.string().nullable(),
  mergeAfter: z.string().nullable(),
  lastDecision: z.string(),
  failures: z.number().default(0),
  retryAfter: z.string().nullable().default(null),
});
type Saved = z.infer<typeof savedSchema>;
function init(store: Store) {
  store.db.exec(
    "CREATE TABLE IF NOT EXISTS task_autonomy(taskId TEXT PRIMARY KEY,data TEXT NOT NULL)",
  );
}
function get(store: Store, id: string) {
  init(store);
  const row = store.db
    .query<{ data: string }, [string]>(
      "SELECT data FROM task_autonomy WHERE taskId=?",
    )
    .get(id);
  return row ? savedSchema.parse(JSON.parse(row.data)) : null;
}
function save(store: Store, state: Saved) {
  init(store);
  state.updatedAt = now();
  store.db
    .query(
      "INSERT INTO task_autonomy VALUES(?,?) ON CONFLICT(taskId) DO UPDATE SET data=excluded.data",
    )
    .run(state.taskId, JSON.stringify(state));
  return state;
}
export function autonomyStatus(store: Store, id: string) {
  const state = get(store, id);
  return state ? autonomySchema.parse(state) : null;
}
const configSchema = z.object({
  mode: autonomyModeSchema,
  base: z.string().trim().max(180).optional(),
  adoptPullRequest: z.string().url().optional(),
});
function requireUnpublishedTask(task: Task) {
  if (
    task.pullRequests.some((pr) => pr.state === "open" || pr.state === "draft")
  )
    throw new Error(
      "This task already has a pull request. Choose that PR in Autopilot to continue its existing branch and reviews.",
    );
}
export async function configureAutonomy(
  store: Store,
  id: string,
  input: unknown,
  overrides: Partial<AutonomyIO> = {},
) {
  const io = { ...defaultIO, ...overrides };
  const config = configSchema.parse(input);
  const task = store.get("task", id);
  if (!task) throw new Error("Task not found.");
  const prior = get(store, id);
  if (config.mode === "off") {
    if (prior)
      save(store, {
        ...prior,
        mode: "off",
        status: "off",
        detail: "Autopilot stopped.",
      });
    return autonomyStatus(store, id);
  }
  if (task.archived)
    throw new Error("Restore the task before enabling Autopilot.");
  requireAvailableProject(store, task.projectId);
  if (task.includeChanges)
    throw new Error("Autopilot requires a task started from committed source.");
  if (!prior?.prUrl && !prior?.publishedHead && !config.adoptPullRequest)
    requireUnpublishedTask(task);
  const project = store.get("project", task.projectId)!;
  const repository = await projectRepository(project);
  if (!repository) throw new Error("Choose a GitHub project to use Autopilot.");
  const candidate = config.adoptPullRequest
    ? task.pullRequests.find(
        (pr) =>
          pr.url === config.adoptPullRequest &&
          ["open", "draft"].includes(pr.state),
      )
    : null;
  if (config.adoptPullRequest && !candidate)
    throw new Error("Choose an open pull request already linked to this task.");
  if (
    prior?.prUrl &&
    config.adoptPullRequest &&
    config.adoptPullRequest !== prior.prUrl
  )
    throw new Error(
      "Autopilot already follows a different pull request for this task.",
    );
  const base = config.base || prior?.base || candidate?.base || project.branch;
  await validateBranch(base);
  if (prior?.prUrl && base !== prior.base)
    throw new Error(
      "The PR base cannot be changed while Autopilot is running.",
    );
  await io.remote([
    "gh",
    "api",
    `repos/${repository}/git/ref/heads/${base}`,
    "--jq",
    ".object.sha",
  ]);
  if (config.mode === "merge")
    await io.mergeCapability(repository, base, io.remote);
  requireAvailableProject(store, task.projectId);
  const state: Saved = prior
    ? {
        ...prior,
        mode: config.mode,
        status: "waiting",
        failures: 0,
        retryAfter: null,
        base,
        detail: "Autopilot enabled.",
      }
    : {
        taskId: id,
        publication: null,
        mode: config.mode,
        status: "waiting",
        repository,
        base,
        branch: `nerilo/${id.slice(0, 8)}`,
        prUrl: null,
        detail: "Autopilot will publish the result and follow PR feedback.",
        repairTurns: 0,
        updatedAt: now(),
        workingPath: null,
        publishedHead: null,
        processedTurnId: null,
        cursor: null,
        ignoredEventIds: [],
        awaitingReply: [],
        rebaseTarget: null,
        mergeAfter: null,
        lastDecision: "",
        failures: 0,
        retryAfter: null,
      };
  let adopted = false;
  if (candidate && !prior?.prUrl && !prior?.publishedHead) {
    if (task.activeTurnId || task.pending.length)
      throw new Error(
        "Wait for queued work to finish before adopting this pull request.",
      );
    if (candidate.repository.toLowerCase() !== repository.toLowerCase())
      throw new Error("This pull request belongs to a different repository.");
    const target = await readPublicationTarget(
      repository,
      candidate.number,
      io.remote,
    );
    requireSameRepositoryPR(target, repository, candidate.head);
    if (target.base.ref !== base)
      throw new Error(
        `This pull request targets ${target.base.ref}. Keep that base when adopting it.`,
      );
    const latest = store
      .all("turn")
      .filter((turn) => turn.taskId === id)
      .at(-1);
    let reviewedPublication = false;
    if (task.checkout) {
      const checkout = await gitStatus(store, id);
      if (checkout.dirty)
        throw new Error(
          "The task checkout has unpublished edits. Commit and publish or discard them explicitly before adopting this PR.",
        );
      reviewedPublication = checkout.head === target.head.sha;
    }
    if (
      !reviewedPublication &&
      (latest?.result?.baseCommit ?? task.source?.headCommit) !==
        target.head.sha
    )
      throw new Error(
        "The PR changed outside this task. Import its latest revision before enabling Autopilot; the existing workspace is retained.",
      );
    const directory = join(dataDir, "checkouts");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = await mkdtemp(join(directory, `${id.slice(0, 8)}-adopted-`));
    try {
      await checked(["git", "init", path]);
      await io.remote([
        ...netGit(path),
        "fetch",
        "--no-tags",
        `https://github.com/${repository}.git`,
        target.head.sha,
      ]);
      await checked([
        "git",
        "-C",
        path,
        "checkout",
        "-b",
        target.head.ref,
        target.head.sha,
      ]);
      const confirmed = await readPublicationTarget(
        repository,
        candidate.number,
        io.remote,
      );
      requireSameRepositoryPR(confirmed, repository, target.head.ref);
      if (confirmed.head.sha !== target.head.sha)
        throw new Error(
          "The PR changed outside this task during adoption. Refresh and try again.",
        );
      state.branch = target.head.ref;
      state.prUrl = candidate.url;
      state.publishedHead = target.head.sha;
      state.workingPath = path;
      state.processedTurnId = reviewedPublication ? (latest?.id ?? null) : null;
      state.detail = `Autopilot will continue PR #${candidate.number} on its existing branch and preserve its review history.`;
      adopted = true;
    } catch (error) {
      await rm(path, { recursive: true, force: true });
      throw error;
    }
  }
  save(store, state);
  if (adopted && candidate)
    captureRepositoryAction(store, id, {
      id: `pr-adopted:${candidate.url}`,
      kind: "pr-linked",
      summary: `Autopilot continued existing pull request #${candidate.number}`,
      headSha: state.publishedHead,
      prUrl: candidate.url,
      url: candidate.url,
    });
  store.event({
    taskId: id,
    turnId: null,
    kind: "system",
    text:
      config.mode === "merge"
        ? "Autopilot enabled through squash merge."
        : "Autopilot enabled for pull request maintenance.",
  });
  return autonomyStatus(store, id);
}
function log(
  store: Store,
  state: Saved,
  status: Saved["status"],
  detail: string,
) {
  const changed = state.status !== status || state.detail !== detail;
  if (changed)
    store.event({
      taskId: state.taskId,
      turnId: null,
      kind: "system",
      text: detail,
    });
  state.status = status;
  state.detail = detail;
  save(store, state);
  if (changed)
    void refreshStateSummary(store, state.taskId, {
      force: status === "merged",
      fixture: summaryFixtures.get(store),
    });
}
const netGit = (path: string) => [
  "git",
  "-C",
  path,
  "-c",
  "credential.helper=",
  "-c",
  "credential.helper=!gh auth git-credential",
];
async function identity(projectPath: string) {
  const git = projectPath ? ["git", "-C", projectPath] : ["git"];
  return {
    name: await checked([...git, "config", "user.name"]),
    email: await checked([...git, "config", "user.email"]),
  };
}
function idle(store: Store, id: string) {
  const task = store.get("task", id);
  if (
    !task ||
    task.archived ||
    store.get("project", task.projectId)?.archived ||
    task.activeTurnId ||
    task.pending.length ||
    task.status === "paused" ||
    task.status === "failed"
  )
    throw new Error("Task is no longer idle.");
  return task;
}
async function remoteHead(state: Saved, io: AutonomyIO) {
  const actual = await io.remoteResult([
    "gh",
    "api",
    `repos/${state.repository}/git/ref/heads/${state.branch}`,
    "--jq",
    ".object.sha",
  ]);
  if (actual.code === 0)
    return z
      .string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(actual.stdout.trim());
  if (actual.stderr.includes("404") || actual.stdout.includes("404"))
    return null;
  throw new Error("Could not verify the remote branch.");
}
async function ensureRemote(state: Saved, io: AutonomyIO) {
  const actual = await remoteHead(state, io);
  if (state.publishedHead ? actual !== state.publishedHead : actual !== null)
    throw new Error(
      "The remote branch changed outside this task. Review it before continuing Autopilot.",
    );
}
async function rejectSnapshot(path: string, ref: string) {
  const authors = await checked([
    "git",
    "-C",
    path,
    "log",
    "--format=%ae",
    ref,
    "--",
  ]);
  if (authors.split("\n").includes("snapshot@nerilo.local"))
    throw new Error(
      "This task includes a local working snapshot. Start from committed source before publishing.",
    );
}
async function reply(
  store: Store,
  state: Saved,
  summary: string,
  io: AutonomyIO,
  changed: boolean,
) {
  if (!state.prUrl || !state.awaitingReply.length) return;
  const number = state.prUrl.split("/").at(-1)!;
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        state.taskId,
        state.publishedHead,
        [...state.awaitingReply].sort(),
      ]),
    )
    .digest("hex");
  const marker = `<!-- nerilo:${state.taskId}:reply:${key} -->`;
  const endpoint = `repos/${state.repository}/issues/${number}/comments`;
  const comments = z
    .array(z.array(z.object({ node_id: z.string(), body: z.string() })))
    .parse(
      JSON.parse(
        await io.remote(["gh", "api", "--paginate", "--slurp", endpoint]),
      ),
    )
    .flat();
  const existing = comments.find((comment) => comment.body.includes(marker));
  let nodeId = existing?.node_id;
  if (!nodeId) {
    idle(store, state.taskId);
    const revision = state.publishedHead?.slice(0, 12);
    const body = `${marker}\n${changed ? `Updated in ${revision}.` : `Reviewed ${revision}; no new commit was needed.`}\n\n${summary.slice(0, 3000)}`;
    nodeId = z
      .object({ node_id: z.string() })
      .parse(
        JSON.parse(
          await io.remote(["gh", "api", endpoint, "-f", `body=${body}`]),
        ),
      ).node_id;
  }
  if (!state.ignoredEventIds.includes(nodeId))
    state.ignoredEventIds.push(nodeId);
  state.awaitingReply = [];
  save(store, state);
}
async function continuesPublishedResult(
  store: Store,
  state: Saved,
  path: string,
  result: RunResult,
  workspaceHead: string,
  publishedTree: string,
) {
  const previous = state.processedTurnId
    ? store.get("turn", state.processedTurnId)
    : null;
  if (
    previous?.taskId !== state.taskId ||
    previous.status !== "finished" ||
    !previous.result ||
    previous.result.truncated ||
    previous.result.baseCommit !== result.baseCommit
  )
    return false;
  const git = ["git", "-C", path];
  if (
    (
      await command([
        ...git,
        "merge-base",
        "--is-ancestor",
        previous.result.headCommit,
        workspaceHead,
      ])
    ).code !== 0
  )
    return false;
  // User follow-ups retain the cumulative sandbox tree even when Autopilot's
  // publication commit lives only in its export. Prove the previous result was
  // exactly that publication before parenting the next result onto it.
  const directory = await mkdtemp(join(dataDir, "autopilot-result-"));
  const env = { GIT_INDEX_FILE: join(directory, "index") };
  try {
    await checked([...git, "read-tree", previous.result.baseCommit], { env });
    if (
      previous.result.diff &&
      (
        await command([...git, "apply", "--cached", "--binary", "-"], {
          env,
          input: `${previous.result.diff}\n`,
        })
      ).code !== 0
    )
      return false;
    return (await checked([...git, "write-tree"], { env })) === publishedTree;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
async function preparePublication(
  store: Store,
  engine: Engine,
  state: Saved,
  io: AutonomyIO,
) {
  const task = idle(store, state.taskId);
  if (!state.prUrl && !state.publishedHead) requireUnpublishedTask(task);
  const project = store.get("project", task.projectId)!;
  const turn = store
    .all("turn")
    .filter((t) => t.taskId === task.id)
    .at(-1);
  if (!turn?.result) return;
  if (turn.result.exitCode !== 0)
    throw new Error(
      "The agent turn failed. Review its output before resuming Autopilot.",
    );
  if (turn.status !== "finished" || turn.result.verification?.exitCode)
    throw new Error(
      "Local verification did not finish successfully. Fix the task and run its checks before resuming Autopilot.",
    );
  // Recover records written by older versions after push but before PR/reply completion.
  if (
    state.processedTurnId === turn.id &&
    state.workingPath &&
    state.publishedHead
  ) {
    state.publication = {
      turnId: turn.id,
      path: state.workingPath,
      head: state.publishedHead,
      previousHead: state.publishedHead,
      rebased: false,
      stage: "pushed",
      prTitle: task.title,
      prBody: turn.result.summary,
      summary: turn.result.summary,
    };
    save(store, state);
    return;
  }
  if (task.includeChanges)
    throw new Error("Autopilot requires a task started from committed source.");
  if (
    state.workingPath &&
    (await checked(["git", "-C", state.workingPath, "status", "--porcelain"]))
  )
    throw new Error(
      "The published workspace has local edits. Review them before continuing Autopilot.",
    );
  const { path } = await engine.checkout(task, project, turn.id);
  const git = ["git", "-C", path];
  await rejectSnapshot(path, turn.result.baseCommit);
  const who = await identity(project.path);
  await checked([...git, "config", "user.name", who.name]);
  await checked([...git, "config", "user.email", who.email]);
  if (state.publishedHead)
    await checked([...git, "fetch", state.workingPath!, state.publishedHead]);
  let parent =
    state.rebaseTarget || state.publishedHead || turn.result.baseCommit;
  if (state.rebaseTarget)
    await io.remote([
      ...netGit(path),
      "fetch",
      `https://github.com/${state.repository}.git`,
      state.rebaseTarget,
    ]);
  const workspaceHead = await checked([...git, "rev-parse", "HEAD"]);
  await checked([...git, "add", "-A", "--", "."]);
  const tree = await checked([...git, "write-tree"]);
  const publishedTree = await checked([
    ...git,
    "rev-parse",
    `${parent}^{tree}`,
  ]);
  let retainedHead: string | null = null;
  if (workspaceHead !== turn.result.baseCommit) {
    if (
      (
        await command([
          ...git,
          "merge-base",
          "--is-ancestor",
          parent,
          workspaceHead,
        ])
      ).code !== 0
    ) {
      if (
        !state.publishedHead ||
        state.rebaseTarget ||
        !(await continuesPublishedResult(
          store,
          state,
          path,
          turn.result,
          workspaceHead,
          publishedTree,
        ))
      )
        throw new Error(
          "The result no longer contains the current publication base. Integrate that revision before Autopilot can publish.",
        );
      if (
        (
          await command([
            ...git,
            "merge-base",
            "--is-ancestor",
            workspaceHead,
            parent,
          ])
        ).code !== 0
      )
        retainedHead = workspaceHead;
    } else parent = workspaceHead;
  } else if (
    state.publishedHead &&
    !state.rebaseTarget &&
    turn.result.baseCommit !== state.publishedHead &&
    tree !== publishedTree &&
    !(await continuesPublishedResult(
      store,
      state,
      path,
      turn.result,
      workspaceHead,
      publishedTree,
    ))
  )
    throw new Error(
      "The agent result started before the latest published revision. Continue from the current PR head before publishing; the reviewed result is retained.",
    );
  const parentTree = await checked([...git, "rev-parse", `${parent}^{tree}`]);
  if (
    tree === parentTree &&
    !state.publishedHead &&
    parent === turn.result.baseCommit
  )
    throw new Error("The task made no changes to publish.");
  let draft = {
    branch: state.branch,
    commitTitle: task.title,
    prTitle: task.title,
    prBody: turn.result.summary,
  };
  let head = parent;
  if (tree !== parentTree || retainedHead) {
    draft = await io
      .draft(
        task.provider,
        task.model,
        `Task: ${task.title}\nActual diff:\n${turn.result.diff.slice(0, 26000)}\nAgent report:\n${turn.result.summary.slice(0, 7000)}\nVerification: ${JSON.stringify(turn.result.verification)?.slice(0, 5000)}`,
      )
      .catch(() => draft);
    idle(store, task.id);
    head = await checked(
      [
        ...git,
        "commit-tree",
        tree,
        "-p",
        parent,
        ...(retainedHead ? ["-p", retainedHead] : []),
        "-F",
        "-",
      ],
      { input: draft.commitTitle },
    );
  }
  await checked([...git, "update-ref", `refs/heads/${state.branch}`, head]);
  await checked([...git, "symbolic-ref", "HEAD", `refs/heads/${state.branch}`]);
  await checked([...git, "reset", "--mixed", head]);
  state.publication = {
    turnId: turn.id,
    path,
    head,
    previousHead: state.publishedHead,
    rebased: Boolean(state.rebaseTarget),
    stage: "prepared",
    prTitle: draft.prTitle,
    prBody: draft.prBody,
    summary: turn.result.summary,
  };
  save(store, state);
}
async function publish(
  store: Store,
  engine: Engine,
  state: Saved,
  io: AutonomyIO,
) {
  log(
    store,
    state,
    "publishing",
    "Preparing the task changes for its pull request.",
  );
  if (!state.publication) await preparePublication(store, engine, state, io);
  const pending = state.publication;
  if (!pending) return;
  const changed = pending.head !== pending.previousHead;
  idle(store, state.taskId);
  if (
    (await checked(["git", "-C", pending.path, "status", "--porcelain"])) ||
    (await checked(["git", "-C", pending.path, "rev-parse", "HEAD"])) !==
      pending.head
  )
    throw new Error(
      "The prepared publication checkout changed. Review it before continuing Autopilot.",
    );
  await rejectSnapshot(pending.path, pending.head);
  const actual = await remoteHead(state, io);
  if (pending.stage === "prepared") {
    // A timed-out push may already have succeeded. Adopt only this exact commit.
    if (actual !== pending.head) {
      if (actual !== pending.previousHead)
        throw new Error(
          "The remote branch changed outside this task. Review it before continuing Autopilot.",
        );
      if (
        pending.previousHead &&
        !pending.rebased &&
        (
          await command([
            "git",
            "-C",
            pending.path,
            "merge-base",
            "--is-ancestor",
            pending.previousHead,
            pending.head,
          ])
        ).code !== 0
      )
        throw new Error(
          "The publication would discard the previous PR head. Integrate it before publishing.",
        );
      idle(store, state.taskId);
      await io.remote(
        [
          ...netGit(pending.path),
          "push",
          `--force-with-lease=refs/heads/${state.branch}:${pending.previousHead ?? ""}`,
          `https://github.com/${state.repository}.git`,
          `${pending.head}:refs/heads/${state.branch}`,
        ],
        { timeout: 90000 },
      );
    }
    state.workingPath = pending.path;
    state.publishedHead = pending.head;
    state.rebaseTarget = null;
    if (changed) state.mergeAfter = new Date(Date.now() + 45000).toISOString();
    pending.stage = "pushed";
    save(store, state);
  } else if (actual !== pending.head)
    throw new Error(
      "The remote branch changed outside this task. Review it before continuing Autopilot.",
    );
  if (changed)
    captureRepositoryAction(
      store,
      state.taskId,
      {
        id: `published:${pending.head}`,
        kind: "published",
        summary: pending.rebased
          ? "Updated the branch and published changes"
          : "Published changes",
        headSha: pending.head,
        prUrl: state.prUrl,
        url: `https://github.com/${state.repository}/commit/${pending.head}`,
      },
      pending.turnId,
    );
  const alreadyFollowing = Boolean(state.prUrl);
  let createdPR = false;
  if (!state.prUrl) {
    const existing = await io.remote([
      "gh",
      "pr",
      "list",
      "--repo",
      state.repository,
      "--head",
      state.branch,
      "--base",
      state.base,
      "--state",
      "all",
      // --head matches branch names only, so skip same-named fork PRs.
      "--json",
      "url,isCrossRepository",
      "--jq",
      "map(select(.isCrossRepository | not))[0].url // empty",
    ]);
    if (existing) state.prUrl = existing.trim();
    else {
      const bodyFile = join(dataDir, `autopilot-${state.taskId}.md`);
      await Bun.write(bodyFile, pending.prBody.slice(0, 12000));
      try {
        state.prUrl = (
          await io.remote([
            "gh",
            "pr",
            "create",
            "--repo",
            state.repository,
            "--head",
            state.branch,
            "--base",
            state.base,
            "--title",
            pending.prTitle,
            "--body-file",
            bodyFile,
          ])
        ).trim();
        createdPR = true;
      } finally {
        await rm(bodyFile, { force: true });
      }
    }
    save(store, state);
  }
  const pr = await io.readPR(state.prUrl);
  if (!alreadyFollowing)
    captureRepositoryAction(
      store,
      state.taskId,
      {
        id: `pr-linked:${pr.url}`,
        kind: createdPR ? "pr-opened" : "pr-linked",
        summary: createdPR
          ? `Pull request #${pr.number} opened`
          : `Linked existing pull request #${pr.number}`,
        prUrl: pr.url,
        url: pr.url,
      },
      pending.turnId,
    );
  const fresh = store.get("task", state.taskId)!;
  store.put("task", fresh.id, {
    ...fresh,
    pullRequests: [...fresh.pullRequests.filter((p) => p.url !== pr.url), pr],
  });
  await reply(store, state, pending.summary, io, changed);
  state.processedTurnId = pending.turnId;
  state.publication = null;
  log(
    store,
    state,
    "reviewing",
    changed
      ? "Published the task changes. Waiting for PR checks and feedback."
      : "Reviewed the existing PR head. No new commit or push was needed.",
  );
}
async function syncWorkspace(
  store: Store,
  state: Saved,
  baseSha: string,
  io: AutonomyIO,
) {
  const task = idle(store, state.taskId);
  if (!state.workingPath || !state.publishedHead)
    throw new Error("No published workspace is available.");
  const path = state.workingPath;
  await ensureRemote(state, io);
  await io.remote([
    ...netGit(path),
    "fetch",
    `https://github.com/${state.repository}.git`,
    `${baseSha}:refs/remotes/nerilo/base`,
  ]);
  await checked([
    "git",
    "-C",
    path,
    "update-ref",
    "refs/heads/nerilo-base",
    baseSha,
  ]);
  const bundle = join(dataDir, "snapshots", `${task.id}.bundle`);
  await mkdir(join(dataDir, "snapshots"), { recursive: true });
  const temporary = join(dataDir, "snapshots", `${task.id}.next.bundle`);
  await rm(temporary, { force: true });
  await checked([
    "git",
    "-C",
    path,
    "bundle",
    "create",
    temporary,
    "HEAD",
    `refs/heads/${state.branch}`,
    "refs/heads/nerilo-base",
  ]);
  const image = await checked([
    "docker",
    "image",
    "inspect",
    "--format",
    "{{.Id}}",
    imageTag,
  ]);
  const helper = `nerilo-sync-${task.id}`;
  await command(["docker", "rm", "-f", helper]);
  try {
    await checked([
      "docker",
      "create",
      "--name",
      helper,
      "--label",
      "dev.nerilo.managed=true",
      "--label",
      `dev.nerilo.task=${task.id}`,
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--network=none",
      "--mount",
      `type=volume,source=nerilo-work-${task.id},target=/work`,
      "--entrypoint",
      "sleep",
      image,
      "120",
    ]);
    await checked([
      "docker",
      "cp",
      temporary,
      `${helper}:/work/autopilot.bundle`,
    ]);
    await checked(["docker", "start", helper]);
    const git = ["docker", "exec", helper, "git", "-C", "/work/repo"];
    await checked([
      ...git,
      "fetch",
      "/work/autopilot.bundle",
      `+refs/heads/${state.branch}:refs/remotes/nerilo/head`,
      "+refs/heads/nerilo-base:refs/remotes/nerilo/base",
    ]);
    idle(store, task.id);
    await checked([...git, "reset", "--hard", state.publishedHead]);
    const who = await identity(store.get("project", task.projectId)!.path);
    await checked([...git, "config", "user.name", who.name]);
    await checked([...git, "config", "user.email", who.email]);
    await checked([
      "docker",
      "exec",
      helper,
      "rm",
      "-f",
      "/work/autopilot.bundle",
    ]);
    await copyFile(temporary, bundle);
    const fresh = store.get("task", task.id)!;
    store.put("task", task.id, { ...fresh, baseCommit: state.publishedHead });
  } finally {
    await command(["docker", "rm", "-f", helper]);
    await rm(temporary, { force: true });
  }
}
async function queueRepair(
  store: Store,
  state: Saved,
  observation: PullRequestObservation,
  io: AutonomyIO,
) {
  if (state.repairTurns >= 12)
    throw new Error(
      "Autopilot reached its 12-turn repair limit. Review the task before continuing.",
    );
  await syncWorkspace(store, state, observation.baseSha, io);
  let prompt = observation.decision.prompt;
  if (observation.decision.action === "update-base") {
    state.rebaseTarget = null;
    prompt = `Merge the current base ${observation.baseSha} into this task branch. The base is available at refs/remotes/nerilo/base. Preserve the existing branch history and resolve conflicts while keeping both the requested feature and base changes. Do not rebase, reset, or discard either side. Run the project checks. Nerilo will preserve the merge ancestry and publish with a lease against the current PR head.\n\n${prompt}`;
  }
  prompt = `${autopilotPromptPrefix}\n\n${prompt}`;
  const fresh = idle(store, state.taskId);
  const inputId = crypto.randomUUID();
  state.cursor = observation.newCursor;
  state.awaitingReply = observation.events
    .filter((e) => e.kind === "feedback" && e.actionable)
    .map((e) => e.id);
  state.repairTurns++;
  store.transaction(() => {
    save(store, state);
    store.put("task", fresh.id, {
      ...fresh,
      pending: [
        {
          id: inputId,
          requestOrigin: repairOrigin(observation),
          text: prompt.slice(0, 30000),
          createdAt: now(),
          scheduledAt: null,
        },
      ],
      status: "queued",
      error: null,
      updatedAt: now(),
    });
    store.event({
      taskId: fresh.id,
      turnId: null,
      kind: "user",
      text: prompt.slice(0, 30000),
    });
  });
  log(
    store,
    state,
    "working",
    observation.decision.action === "update-base"
      ? "Updating the task branch against its base."
      : "The agent is addressing PR feedback and checks.",
  );
}
const busy = new Set<string>();
export async function tickAutonomy(
  store: Store,
  engine: Engine,
  overrides: Partial<AutonomyIO> = {},
) {
  summaryFixtures.set(store, engine.fixture);
  const io = { ...defaultIO, ...overrides };
  init(store);
  for (const row of store.db
    .query<{ data: string }, []>("SELECT data FROM task_autonomy")
    .all()) {
    const state = savedSchema.parse(JSON.parse(row.data));
    if (
      state.mode === "off" ||
      ["merged", "closed"].includes(state.status) ||
      busy.has(state.taskId) ||
      isTaskLocked(state.taskId) ||
      state.failures >= 3 ||
      (state.retryAfter !== null && Date.now() < Date.parse(state.retryAfter))
    )
      continue;
    const task = store.get("task", state.taskId);
    if (
      !task ||
      task.archived ||
      store.get("project", task.projectId)?.archived ||
      task.status === "paused"
    )
      continue;
    if (task.status === "failed") {
      const detail =
        "The latest agent turn failed. Retry or send a follow-up before Autopilot can continue.";
      if (state.status !== "blocked" || state.detail !== detail)
        log(store, state, "blocked", detail);
      continue;
    }
    if (task.activeTurnId || task.pending.length) {
      if (state.status !== "working")
        log(store, state, "working", "The agent is working on the task.");
      continue;
    }
    busy.add(state.taskId);
    try {
      await withTaskGithubAccount(store, state.taskId, () =>
        withTaskLock(state.taskId, async () => {
          const turn = store
            .all("turn")
            .filter((t) => t.taskId === state.taskId)
            .at(-1);
          if (
            state.publication ||
            (turn?.result &&
              (turn.id !== state.processedTurnId ||
                !state.prUrl ||
                state.awaitingReply.length))
          )
            await publish(store, engine, state, io);
          if (!state.prUrl) return;
          const observation = await io.observe({
            url: state.prUrl,
            cursor: state.cursor ?? undefined,
            ignoredEventIds: state.ignoredEventIds,
            mode: state.mode === "merge" ? "merge" : "pr",
          });
          captureObservation(store, state.taskId, observation);
          if (observation.state !== "OPEN") {
            const pr = await io.readPR(state.prUrl);
            const current = store.get("task", state.taskId)!;
            store.put("task", current.id, {
              ...current,
              status:
                observation.state === "MERGED" ? "complete" : current.status,
              pullRequests: [
                ...current.pullRequests.filter((value) => value.url !== pr.url),
                pr,
              ],
            });
            log(
              store,
              state,
              observation.state === "MERGED" ? "merged" : "closed",
              observation.state === "MERGED"
                ? "Pull request merged."
                : "Pull request closed.",
            );
            return;
          }
          if (observation.headSha !== state.publishedHead) {
            if ((await remoteHead(state, io)) === state.publishedHead) {
              log(
                store,
                state,
                "reviewing",
                "Waiting for GitHub to refresh the pull request after publishing.",
              );
              return;
            }
            throw new Error(
              "The PR changed outside this task. Review it before continuing Autopilot.",
            );
          }
          if (
            observation.decision.action === "repair" ||
            observation.decision.action === "update-base"
          )
            await queueRepair(store, state, observation, io);
          else if (
            observation.decision.action === "merge" &&
            state.mode === "merge"
          ) {
            if (state.mergeAfter && Date.now() < Date.parse(state.mergeAfter)) {
              log(
                store,
                state,
                "reviewing",
                "Checks are green. Waiting briefly for final feedback.",
              );
              return;
            }
            const fresh = await io.observe({
              url: state.prUrl,
              cursor: state.cursor ?? undefined,
              ignoredEventIds: state.ignoredEventIds,
              mode: "merge",
            });
            captureObservation(store, state.taskId, fresh);
            if (
              fresh.decision.action !== "merge" ||
              fresh.headSha !== observation.headSha ||
              fresh.baseSha !== observation.baseSha
            ) {
              log(
                store,
                state,
                "reviewing",
                "PR state changed. Rechecking before merge.",
              );
              return;
            }
            idle(store, state.taskId);
            const response = z
              .object({ merged: z.boolean(), message: z.string() })
              .parse(
                JSON.parse(
                  await io.remote([
                    "gh",
                    "api",
                    "--method",
                    "PUT",
                    `repos/${state.repository}/pulls/${fresh.number}/merge`,
                    "-f",
                    "merge_method=squash",
                    "-f",
                    `sha=${fresh.headSha}`,
                    "-f",
                    `commit_title=${fresh.title} (#${fresh.number})`,
                  ]),
                ),
              );
            if (!response.merged) throw new Error(response.message);
            captureRepositoryAction(store, state.taskId, {
              id: `pr:${state.prUrl}:MERGED`,
              kind: "merged",
              summary: "Pull request squash-merged",
              prUrl: state.prUrl,
              url: state.prUrl,
              headSha: fresh.headSha,
            });
            const current = store.get("task", state.taskId)!;
            const pr = await io.readPR(state.prUrl);
            store.put("task", current.id, {
              ...current,
              status: "complete",
              pullRequests: [
                ...current.pullRequests.filter((p) => p.url !== pr.url),
                pr,
              ],
            });
            log(
              store,
              state,
              "merged",
              "Checks and review requirements passed. Pull request squash-merged.",
            );
          } else {
            state.cursor = observation.newCursor;
            log(
              store,
              state,
              observation.decision.action === "blocked"
                ? "blocked"
                : "reviewing",
              observation.decision.action === "merge"
                ? "The pull request is ready to merge."
                : observation.decision.reasons.join(" "),
            );
          }
        }),
      );
      state.failures = 0;
      state.retryAfter = null;
      save(store, state);
    } catch (reason) {
      state.failures++;
      state.retryAfter = new Date(
        Date.now() + 15000 * 2 ** state.failures,
      ).toISOString();
      log(
        store,
        state,
        "blocked",
        reason instanceof Error ? reason.message : String(reason),
      );
    } finally {
      busy.delete(state.taskId);
    }
  }
}
