import { test, expect } from "bun:test";
import {
  githubPullRequestURL,
  normalizePullRequest,
  readPullRequestSource,
} from "./pull-requests";
const base = {
  url: "https://github.com/example/app/pull/142",
  number: 142,
  title: "Improve navigation",
  state: "OPEN",
  isDraft: false,
  reviewDecision: "APPROVED",
  mergeable: "MERGEABLE",
  headRefName: "navigation",
  baseRefName: "main",
  statusCheckRollup: [],
};

test("PR imports include the current target branch after teammates merge changes", async () => {
  const originalBase = "1".repeat(40);
  const currentBase = "2".repeat(40);
  const head = "3".repeat(40);
  const requests: string[][] = [];
  const result = await readPullRequestSource(
    base.url,
    { path: "", repository: "example/app" },
    {
      checked: async (args) => {
        requests.push(args);
        if (args[1] === "pr")
          return JSON.stringify({
            ...base,
            baseRefName: "release/next",
            baseRefOid: originalBase,
            headRefOid: head,
          });
        return currentBase;
      },
    },
  );
  expect(result.source).toMatchObject({
    headCommit: head,
    baseCommit: currentBase,
  });
  expect(requests[1]).toEqual([
    "gh",
    "api",
    "repos/example/app/git/ref/heads/release%2Fnext",
    "--jq",
    ".object.sha",
  ]);
  await expect(
    readPullRequestSource(
      base.url,
      { path: "", repository: "example/app" },
      {
        checked: async (args) => {
          if (args[1] === "pr")
            return JSON.stringify({
              ...base,
              baseRefOid: originalBase,
              headRefOid: head,
            });
          throw new Error("Target branch unavailable");
        },
      },
    ),
  ).rejects.toThrow("Could not read this PR's revisions");
});
test("PR review approval does not hide failing or running checks", () => {
  const pr = normalizePullRequest({
    ...base,
    statusCheckRollup: [
      { name: "Build", status: "COMPLETED", conclusion: "FAILURE" },
      { name: "Tests", status: "IN_PROGRESS", conclusion: "" },
    ],
  });
  expect(pr.review).toBe("approved");
  expect(pr.checks).toBe("failing");
  expect(pr.state).toBe("open");
  expect(
    normalizePullRequest({
      ...base,
      statusCheckRollup: [{ context: "CI", state: "PENDING" }],
    }).checks,
  ).toBe("pending");
});
test("missing checks remain unknown and terminal PR states survive review metadata", () => {
  expect(normalizePullRequest(base).checks).toBe("none");
  expect(
    normalizePullRequest({
      ...base,
      state: "MERGED",
      reviewDecision: "CHANGES_REQUESTED",
    }).state,
  ).toBe("merged");
  expect(
    normalizePullRequest({ ...base, isDraft: true, mergeable: "CONFLICTING" }),
  ).toMatchObject({ state: "draft", conflicts: true });
  expect(
    normalizePullRequest({
      ...base,
      statusCheckRollup: [
        { status: "COMPLETED", conclusion: "SKIPPED" },
        { state: "SUCCESS" },
      ],
    }).checks,
  ).toBe("passing");
});
test("PR URLs are restricted to GitHub PR pages before invoking the CLI", () => {
  expect(githubPullRequestURL(base.url + "#discussion")).toBe(base.url);
  for (const url of [
    "--help",
    "https://evil.test/a/b/pull/1",
    "https://github.com.evil.test/a/b/pull/1",
    "https://user:pass@github.com/a/b/pull/1",
    "file:///etc/passwd",
    "https://github.com/a/b/issues/1",
  ])
    expect(() => githubPullRequestURL(url)).toThrow();
});

test("GitHub remotes normalize SSH and HTTPS without accepting credentials or lookalike hosts", async () => {
  const { githubRepository } = await import("./pull-requests");
  for (const remote of [
    "https://github.com/facebook/astryx.git",
    "git@github.com:facebook/astryx.git",
    "ssh://git@github.com/facebook/astryx",
    "https://github.com/facebook/astryx/",
  ])
    expect(githubRepository(remote)).toBe("facebook/astryx");
  for (const remote of [
    "https://user:secret@github.com/a/b",
    "https://github.com.evil.test/a/b",
    "git@github.com:a/../b",
    "file:///a/b",
    "https://github.com/a/..",
    "https://github.com/-a/b",
  ])
    expect(githubRepository(remote)).toBeNull();
});

test("project PR history requests the selected state without mixing open and completed lists", async () => {
  const { listProjectPullRequests } = await import("./pull-requests");
  const calls: string[][] = [];
  const network = {
    checked: async (args: string[]) => {
      calls.push(args);
      return JSON.stringify([
        {
          ...base,
          state: "MERGED",
          author: { login: "teammate" },
          headRefOid: "c".repeat(40),
        },
      ]);
    },
  };
  const result = await listProjectPullRequests(
    { path: "", repository: "example/app" },
    "merged",
    network,
  );
  expect(
    calls[0].slice(
      calls[0].indexOf("--state"),
      calls[0].indexOf("--state") + 2,
    ),
  ).toEqual(["--state", "merged"]);
  expect(result.pullRequests[0]).toMatchObject({
    state: "merged",
    author: "teammate",
    headSha: "c".repeat(40),
  });
});

test("closed history excludes merged PRs in the GitHub query before applying the display limit", async () => {
  const { listProjectPullRequests } = await import("./pull-requests");
  let requested: string[] = [];
  const result = await listProjectPullRequests(
    { path: "", repository: "example/app" },
    "closed",
    {
      checked: async (args) => {
        requested = args;
        const query = args[args.indexOf("--search") + 1];
        const state =
          query === "is:unmerged sort:created-desc" ? "CLOSED" : "MERGED";
        return JSON.stringify(
          Array.from({ length: 51 }, (_, index) => ({
            ...base,
            number: index + 1,
            state,
          })),
        );
      },
    },
  );
  expect(requested).toContain("is:unmerged sort:created-desc");
  expect(
    requested.slice(
      requested.indexOf("--limit"),
      requested.indexOf("--limit") + 2,
    ),
  ).toEqual(["--limit", "51"]);
  expect(result.pullRequests).toHaveLength(50);
  expect(result.pullRequests.every((pr) => pr.state === "closed")).toBe(true);
  expect(result.limited).toBe(true);
});
