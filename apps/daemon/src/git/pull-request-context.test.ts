import { expect, test } from "bun:test";
import { readPullRequestContext } from "./pull-request-context";

import {
  contextFixture,
  head,
  target,
  url,
  page,
} from "./pull-request-context.fixture";

test("PR work captures exact revisions and complete review context while excluding resolved and draft feedback", async () => {
  const network = contextFixture();
  const result = await readPullRequestContext(
    url,
    { path: "", repository: "example/repo" },
    network,
  );
  expect(result.pr.author).toBe("contributor");
  expect(result.pr.headSha).toBe(head);
  expect(result.source).toMatchObject({
    headCommit: head,
    baseCommit: target,
    headBranch: "feature",
    baseBranch: "main",
    headRepository: "example/repo",
  });
  expect(result.feedbackCount).toBe(3);
  for (const text of [
    "CHANGES_REQUESTED",
    "Normalize unknown priorities.",
    "src/queue.mjs:8",
    "on an older revision",
    "Follow-up after the first page.",
    "Preserve title trimming.",
    head,
    target,
  ])
    expect(result.feedback).toContain(text);
  expect(result.feedback).not.toContain("Already resolved.");
  expect(result.feedback).not.toContain("Unsubmitted draft.");
  expect(
    network.calls
      .filter((args) => args.includes("graphql"))
      .every((args) => args.includes("--paginate") && args.includes("--slurp")),
  ).toBe(true);
  const stable = await readPullRequestContext(
    url,
    { path: "", repository: "example/repo" },
    network,
  );
  expect(stable.contextHash).toBe(result.contextHash);
  network.setReview("A new blocking requirement.");
  const changed = await readPullRequestContext(
    url,
    { path: "", repository: "example/repo" },
    network,
  );
  expect(changed.contextHash).not.toBe(result.contextHash);
});

test("a PR changing while feedback loads cannot be presented as one consistent revision", async () => {
  const fixture = contextFixture();
  await expect(
    readPullRequestContext(
      url,
      { path: "", repository: "example/repo" },
      {
        checked: async (args) =>
          args.includes("graphql")
            ? JSON.stringify([page("reviews", [], "c".repeat(40))])
            : fixture.checked(args),
      },
    ),
  ).rejects.toThrow("changed while its feedback was loading");
});
