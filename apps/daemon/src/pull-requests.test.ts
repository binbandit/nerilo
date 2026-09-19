import { test, expect } from "bun:test";
import { githubPullRequestURL, normalizePullRequest } from "./pull-requests";
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
