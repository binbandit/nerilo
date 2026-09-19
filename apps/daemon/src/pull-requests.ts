import { z } from "zod";
import type { PullRequest, Project } from "@nerilo/protocol";
import { pullRequestSourceSchema } from "@nerilo/protocol";
import { checked, command } from "./config";
import { captureObservation } from "./repository-history";
import type { PullRequestObservation } from "./pr-observer";

const fields =
  "url,number,title,state,isDraft,reviewDecision,mergeable,headRefName,baseRefName,statusCheckRollup";

export function githubPullRequestURL(input: string) {
  const match = input
    .trim()
    .match(
      /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([1-9]\d*)\/?(?:[?#].*)?$/,
    );
  if (!match) throw new Error("Use a GitHub pull request URL.");
  return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
}
const checkSchema = z.object({
  name: z.string().optional(),
  context: z.string().optional(),
  status: z.string().optional(),
  conclusion: z.string().nullable().optional(),
  state: z.string().optional(),
});
const githubSchema = z.object({
  url: z.string(),
  number: z.number().int(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED", "MERGED"]),
  isDraft: z.boolean(),
  reviewDecision: z.string().nullable(),
  mergeable: z.string(),
  headRefName: z.string(),
  baseRefName: z.string(),
  statusCheckRollup: z.array(checkSchema).nullable(),
});
export function normalizePullRequest(input: unknown): PullRequest {
  const raw = githubSchema.parse(input);
  const url = githubPullRequestURL(raw.url);
  const checks = (raw.statusCheckRollup ?? []).map((check) => {
    const value = check.conclusion || check.state || check.status || "";
    return {
      name: check.name ?? check.context ?? "Check",
      state: [
        "FAILURE",
        "ERROR",
        "TIMED_OUT",
        "CANCELLED",
        "ACTION_REQUIRED",
        "STARTUP_FAILURE",
        "STALE",
      ].includes(value)
        ? ("failing" as const)
        : ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(value)
          ? ("passing" as const)
          : ("pending" as const),
    };
  });
  return {
    url,
    number: raw.number,
    title: raw.title,
    repository: url.split("/").slice(3, 5).join("/"),
    state:
      raw.state === "MERGED"
        ? "merged"
        : raw.state === "CLOSED"
          ? "closed"
          : raw.isDraft
            ? "draft"
            : "open",
    review:
      raw.reviewDecision === "APPROVED"
        ? "approved"
        : raw.reviewDecision === "CHANGES_REQUESTED"
          ? "changes_requested"
          : raw.reviewDecision === "REVIEW_REQUIRED"
            ? "required"
            : "none",
    checks: checks.some((check) => check.state === "failing")
      ? "failing"
      : checks.some((check) => check.state === "pending")
        ? "pending"
        : checks.length
          ? "passing"
          : "none",
    checkRuns: checks,
    conflicts: raw.mergeable === "CONFLICTING",
    head: raw.headRefName,
    base: raw.baseRefName,
    syncedAt: new Date().toISOString(),
    error: null,
  };
}
export async function readPullRequest(url: string) {
  const canonical = githubPullRequestURL(url);
  try {
    const output = await checked(
      ["gh", "pr", "view", canonical, "--json", fields],
      { timeout: 15000 },
    );
    return normalizePullRequest(JSON.parse(output));
  } catch {
    throw new Error(
      "Could not read this PR. Check the URL and the GitHub CLI login on this Mac.",
    );
  }
}

import type { Store } from "./store";
export async function refreshLinkedPullRequests(
  store: Store,
  history: {
    read?: typeof readPullRequest;
    observe?: (input: { url: string }) => Promise<PullRequestObservation>;
    autopilotObserves?: (taskId: string, url: string) => boolean;
  } = {},
) {
  const observations = new Map<string, Promise<PullRequestObservation>>();
  for (const task of store.all("task").filter((task) => !task.archived)) {
    for (const previous of task.pullRequests) {
      if (Date.now() - Date.parse(previous.syncedAt) < 60000) continue;
      let next: PullRequest;
      let observation: PullRequestObservation | null = null;
      try {
        next = await (history.read ?? readPullRequest)(previous.url);
        if (
          history.observe &&
          !history.autopilotObserves?.(task.id, previous.url)
        ) {
          try {
            let pending = observations.get(previous.url);
            if (!pending) {
              pending = history.observe({ url: previous.url });
              observations.set(previous.url, pending);
            }
            observation = await pending;
          } catch {
            next.error =
              "PR status updated, but detailed history is unavailable. It will retry on the next refresh.";
          }
        }
      } catch (e) {
        next = {
          ...previous,
          syncedAt: new Date().toISOString(),
          error: e instanceof Error ? e.message : String(e),
        };
      }
      const current = store.get("task", task.id);
      if (
        !current ||
        !current.pullRequests.some(
          (pr) => pr.url === previous.url && pr.syncedAt === previous.syncedAt,
        )
      )
        continue;
      if (observation) captureObservation(store, task.id, observation);
      store.put("task", task.id, {
        ...current,
        pullRequests: current.pullRequests.map((pr) =>
          pr.url === previous.url ? next : pr,
        ),
      });
    }
  }
}

export function githubRepository(remote: string): string | null {
  const match = remote
    .trim()
    .match(
      /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)\/?$/,
    );
  if (!match) return null;
  const owner = match[1];
  const repository = match[2].replace(/\.git$/, "");
  if (
    [owner, repository].some(
      (part) => !part || part === "." || part === ".." || part.startsWith("-"),
    )
  )
    return null;
  return `${owner}/${repository}`;
}
type RepositorySource = string | Pick<Project, "path" | "repository">;
export async function projectRepository(project: RepositorySource) {
  if (typeof project !== "string" && project.repository)
    return githubRepository(`https://github.com/${project.repository}`);
  const path = typeof project === "string" ? project : project.path;
  if (!path) return null;
  const remote = await command([
    "git",
    "-C",
    path,
    "remote",
    "get-url",
    "origin",
  ]);
  return remote.code ? null : githubRepository(remote.stdout);
}
export async function listProjectPullRequests(project: RepositorySource) {
  const repository = await projectRepository(project);
  if (!repository)
    return { repository: null, pullRequests: [], limited: false };
  try {
    const output = await checked(
      [
        "gh",
        "pr",
        "list",
        "--repo",
        repository,
        "--state",
        "open",
        "--limit",
        "51",
        "--json",
        fields,
      ],
      { timeout: 30000 },
    );
    const rows = z.array(githubSchema).parse(JSON.parse(output));
    return {
      repository,
      pullRequests: rows.slice(0, 50).map(normalizePullRequest),
      limited: rows.length > 50,
    };
  } catch {
    throw new Error(
      "Could not load pull requests. Check this project's access with the GitHub CLI on this Mac.",
    );
  }
}
export async function readPullRequestSource(
  url: string,
  project: RepositorySource,
) {
  const canonical = githubPullRequestURL(url);
  const repository = await projectRepository(project);
  if (
    repository?.toLowerCase() !==
    canonical.split("/").slice(3, 5).join("/").toLowerCase()
  )
    throw new Error(
      "Choose a pull request from this project's GitHub repository.",
    );
  try {
    const output = await checked(
      [
        "gh",
        "pr",
        "view",
        canonical,
        "--json",
        `${fields},headRefOid,baseRefOid`,
      ],
      { timeout: 15000 },
    );
    const raw = githubSchema
      .extend({ headRefOid: z.string(), baseRefOid: z.string() })
      .parse(JSON.parse(output));
    const pr = normalizePullRequest(raw);
    return {
      pr,
      source: pullRequestSourceSchema.parse({
        url: pr.url,
        repository: pr.repository,
        number: pr.number,
        headCommit: raw.headRefOid,
        baseCommit: raw.baseRefOid,
      }),
    };
  } catch {
    throw new Error(
      "Could not read this PR's revisions. Check its URL and your GitHub CLI access.",
    );
  }
}
