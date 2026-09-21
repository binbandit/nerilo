import { describe, expect, test } from "bun:test";
import {
  decidePullRequest,
  observeRules,
  validateMergeCapability,
  type PullRequestFacts,
  type ObservedCheck,
} from "./pr-observer";

const head = "a".repeat(40);
const base = "b".repeat(40);
const observedAt = "2026-09-10T12:00:00.000Z";
const passing: ObservedCheck = {
  id: "check:1",
  name: "test",
  appId: 42,
  state: "passing",
  headSha: head,
  url: "https://github.com/binbandit/test-repo/actions/runs/1",
  details: "",
  updatedAt: observedAt,
};
function facts(overrides: Partial<PullRequestFacts> = {}): PullRequestFacts {
  return {
    url: "https://github.com/binbandit/test-repo/pull/1",
    repository: "binbandit/test-repo",
    number: 1,
    title: "Example",
    observedAt,
    state: "OPEN",
    draft: false,
    headSha: head,
    baseSha: base,
    prBaseSha: base,
    headBranch: "nerilo/example",
    baseBranch: "main",
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    behindBy: 0,
    canMerge: true,
    squashAllowed: true,
    rules: {
      known: true,
      strict: false,
      requiredChecks: [{ name: "test", appId: 42 }],
      approvingReviews: 0,
      conversationResolution: false,
      mergeQueue: false,
      squashAllowed: true,
      error: null,
    },
    checks: [passing],
    checksKnown: true,
    feedback: [],
    unresolvedThreads: [],
    complete: true,
    errors: [],
    ...overrides,
  };
}

describe("PR observer eligibility", () => {
  test("adoption keeps review history without repairing approvals or superseded change requests", () => {
    const request: PullRequestFacts["feedback"][number] = {
      id: "review:5260391239",
      fingerprint: "review:5260391239:request",
      kind: "review",
      author: "sage-smudge",
      body: "Reject non-string assignment values.",
      url: "https://github.com/example/repo/pull/2#pullrequestreview-5260391239",
      updatedAt: "2026-09-20T10:00:00Z",
      headSha: base,
      threadId: null,
      state: "CHANGES_REQUESTED",
      actionable: true,
    };
    const approval = {
      ...request,
      id: "review:5260420543",
      fingerprint: "review:5260420543:approval",
      body: "The repaired validation passes. Approved.",
      updatedAt: "2026-09-20T10:10:00Z",
      headSha: head,
      state: "APPROVED",
    };
    const reviewed = facts({
      feedback: [approval, request],
      reviewDecision: "APPROVED",
    });
    const adopted = decidePullRequest(reviewed);
    expect(adopted.decision.action).toBe("merge");
    expect(adopted.feedback).toHaveLength(2);
    expect(adopted.feedback.map((item) => item.state)).toEqual([
      "APPROVED",
      "CHANGES_REQUESTED",
    ]);
    expect(adopted.events.every((event) => !event.actionable)).toBe(true);
    expect(adopted.decision.prompt).not.toContain(request.body);
    expect(adopted.decision.prompt).not.toContain(approval.body);

    // An unrelated push can require a fresh approval without reviving settled feedback.
    const laterHead = "c".repeat(40);
    const pushed = decidePullRequest({
      ...reviewed,
      headSha: laterHead,
      checks: [{ ...passing, headSha: laterHead }],
      reviewDecision: "REVIEW_REQUIRED",
      rules: { ...reviewed.rules, approvingReviews: 1 },
    });
    expect(pushed.decision.action).toBe("wait");
    expect(pushed.decision.reasons).toContain(
      "Required review approval is outstanding.",
    );
    expect(pushed.events.some((event) => event.actionable)).toBe(false);
    const dismissed = decidePullRequest({
      ...reviewed,
      reviewDecision: "REVIEW_REQUIRED",
      feedback: [request, { ...approval, state: "DISMISSED" }],
    });
    expect(dismissed.decision.action).toBe("wait");
    expect(dismissed.events.some((event) => event.actionable)).toBe(false);

    const unresolved = {
      ...request,
      id: "review-comment:9",
      fingerprint: "review-comment:9:open",
      kind: "review-comment" as const,
      state: null,
      threadId: "thread:9",
      body: "The null input still needs a regression test.",
    };
    const pendingThread = decidePullRequest({
      ...reviewed,
      feedback: [...reviewed.feedback, unresolved],
      unresolvedThreads: [
        {
          id: "thread:9",
          path: "src/queue.mjs",
          line: 8,
          outdated: true,
          comments: [unresolved],
        },
      ],
    });
    expect(pendingThread.decision.action).toBe("repair");
    expect(pendingThread.decision.prompt).toContain(unresolved.body);
    expect(pendingThread.decision.prompt).not.toContain(request.body);

    const comment = {
      ...approval,
      id: "review:next",
      fingerprint: "review:next:commented",
      state: "COMMENTED",
      updatedAt: "2026-09-20T10:15:00Z",
      body: "Please also preserve the original ticket object.",
    };
    const followUp = decidePullRequest(
      { ...reviewed, feedback: [...reviewed.feedback, comment] },
      adopted.newCursor,
    );
    expect(followUp.decision.action).toBe("repair");
    expect(followUp.decision.prompt).toContain(comment.body);
    expect(followUp.decision.prompt).not.toContain(request.body);

    expect(
      decidePullRequest({
        ...reviewed,
        feedback: [request, { ...approval, author: "another-reviewer" }],
      }).decision.action,
    ).toBe("repair");
    expect(
      decidePullRequest({
        ...reviewed,
        feedback: [request, { ...approval, updatedAt: "2026-09-20T09:00:00Z" }],
      }).decision.action,
    ).toBe("repair");
    expect(
      decidePullRequest({
        ...reviewed,
        feedback: [
          request,
          approval,
          { ...comment, state: "CHANGES_REQUESTED" },
        ],
      }).decision.action,
    ).toBe("repair");
  });
  test("merge capability validation exposes plan restrictions before work is published", async () => {
    const graph = JSON.stringify({
      data: {
        repository: {
          viewerPermission: "WRITE",
          squashMergeAllowed: true,
          ref: { branchProtectionRule: null },
        },
      },
    });
    await expect(
      validateMergeCapability("example/repo", "main", async (args) => {
        if (args.includes("graphql")) return graph;
        throw new Error(
          "HTTP 403: Upgrade to GitHub Pro or make this repository public to enable this feature.",
        );
      }),
    ).rejects.toThrow("current plan");
    await expect(
      validateMergeCapability("example/repo", "main", async (args) =>
        args.includes("graphql") ? graph : "[]",
      ),
    ).resolves.toBeUndefined();
    await expect(
      validateMergeCapability("example/repo", "main", async (args) =>
        args.includes("graphql") ? graph : "null",
      ),
    ).rejects.toThrow("before using automatic merge");
    await expect(
      validateMergeCapability("example/repo", "main", async (args) =>
        args.includes("graphql") ? graph.replace("WRITE", "READ") : "[]",
      ),
    ).rejects.toThrow("account cannot merge");
  });
  test("feedback-only maintenance repairs with unavailable policy but never infers merge permission", () => {
    const limited = facts({
      complete: false,
      feedbackComplete: true,
      rules: {
        ...facts().rules,
        known: false,
        error:
          "GitHub does not expose branch rules for this private repository.",
      },
      checks: [{ ...passing, state: "failing" }],
    });
    expect(decidePullRequest(limited, undefined, "merge").decision.action).toBe(
      "blocked",
    );
    expect(decidePullRequest(limited, undefined, "pr").decision.action).toBe(
      "repair",
    );
    const quiet = decidePullRequest(
      { ...limited, checks: [passing] },
      undefined,
      "pr",
    );
    expect(quiet.decision.action).toBe("wait");
    expect(quiet.decision.reasons.join(" ")).toContain(
      "Merging is left to you",
    );
    expect(quiet.decision.reasons.join(" ")).not.toContain("requirements");
    expect(
      decidePullRequest(
        { ...limited, feedbackComplete: false, errors: ["Head changed"] },
        undefined,
        "pr",
      ).decision.action,
    ).toBe("blocked");
    expect(
      decidePullRequest({ ...limited, checksKnown: false }, undefined, "pr")
        .decision.action,
    ).toBe("blocked");
  });
  test("accepts disabled nullable review policy while keeping enabled unknown requirements closed", () => {
    // GitHub's real PR 12 protection response: strict CI with reviews disabled.
    const protection = {
      requiresStatusChecks: true,
      requiresStrictStatusChecks: true,
      requiredStatusChecks: [
        { context: "lifecycle", app: { databaseId: 15368 } },
      ],
      requiresApprovingReviews: false,
      requiredApprovingReviewCount: null,
      requiresConversationResolution: true,
    };
    const rules = observeRules(protection, []);
    expect(rules.known).toBe(true);
    expect(rules.approvingReviews).toBe(0);
    expect(rules.strict).toBe(true);
    expect(rules.conversationResolution).toBe(true);
    expect(rules.requiredChecks).toEqual([{ name: "lifecycle", appId: 15368 }]);
    expect(
      decidePullRequest(facts({ rules, checks: [] })).decision.action,
    ).toBe("wait");
    expect(
      decidePullRequest(
        facts({
          rules,
          checks: [{ ...passing, name: "lifecycle", appId: 15368 }],
        }),
      ).decision.action,
    ).toBe("merge");

    const unreadableReviews = observeRules(
      { ...protection, requiresApprovingReviews: true },
      [],
    );
    expect(unreadableReviews.known).toBe(false);
    expect(
      decidePullRequest(facts({ rules: unreadableReviews })).decision.action,
    ).toBe("blocked");
    const unreadableChecks = observeRules(
      { ...protection, requiredStatusChecks: null },
      [],
    );
    expect(unreadableChecks.known).toBe(false);
    expect(
      decidePullRequest(facts({ rules: unreadableChecks })).decision.action,
    ).toBe("blocked");
    const disabledChecks = observeRules(
      {
        ...protection,
        requiresStatusChecks: false,
        requiredStatusChecks: null,
      },
      [],
    );
    expect(disabledChecks.known).toBe(true);
    expect(disabledChecks.requiredChecks).toEqual([]);
  });

  test("requires current-head evidence from the required GitHub App", () => {
    expect(decidePullRequest(facts()).decision.action).toBe("merge");
    expect(decidePullRequest(facts({ checks: [] })).decision.action).toBe(
      "wait",
    );
    expect(
      decidePullRequest(facts({ checks: [{ ...passing, appId: 99 }] })).decision
        .action,
    ).toBe("wait");
    expect(
      decidePullRequest(facts({ checks: [{ ...passing, headSha: base }] }))
        .decision.action,
    ).toBe("blocked");
    const rules = {
      ...facts().rules,
      requiredChecks: [{ name: "test", appId: null }],
    };
    expect(
      decidePullRequest(
        facts({ rules, checks: [{ ...passing, id: "run:1", appId: null }] }),
      ).decision.action,
    ).toBe("wait");
  });

  test("does not equate missing or unreadable policy and CI with success", () => {
    expect(
      decidePullRequest(facts({ checksKnown: false })).decision.action,
    ).toBe("blocked");
    expect(
      decidePullRequest(facts({ rules: { ...facts().rules, known: false } }))
        .decision.action,
    ).toBe("blocked");
    expect(
      decidePullRequest(facts({ complete: false, errors: ["Head changed"] }))
        .decision.action,
    ).toBe("blocked");
    expect(
      decidePullRequest(facts({ mergeStateStatus: "UNKNOWN" })).decision.action,
    ).toBe("wait");
    expect(
      decidePullRequest(facts({ mergeStateStatus: "HAS_HOOKS" })).decision
        .action,
    ).toBe("wait");
  });

  test("honors strict freshness while preserving pending CI otherwise", () => {
    const waiting = facts({
      behindBy: 2,
      checks: [{ ...passing, state: "pending" }],
    });
    const first = decidePullRequest(waiting);
    expect(first.decision.action).toBe("wait");
    const later = decidePullRequest(
      { ...waiting, observedAt: "2026-09-10T12:03:00.000Z" },
      first.newCursor,
    );
    expect(later.baseUpdate.pendingForMs).toBe(180000);
    expect(later.baseUpdate.behindForMs).toBe(180000);
    expect(
      decidePullRequest({
        ...waiting,
        rules: { ...waiting.rules, strict: true },
      }).decision.action,
    ).toBe("update-base");
    expect(
      decidePullRequest(facts({ behindBy: 2, checks: [] })).decision.action,
    ).toBe("wait");
    expect(decidePullRequest(facts({ behindBy: 2 })).decision.action).toBe(
      "update-base",
    );
  });

  test("deduplicates CI failures and review feedback without dropping changed events", () => {
    const feedback: PullRequestFacts["feedback"][number] = {
      id: "comment:1",
      fingerprint: "comment:1:version1",
      kind: "comment",
      author: "reviewer",
      body: "Handle an empty input.",
      url: "https://github.com/binbandit/test-repo/pull/1#issuecomment-1",
      updatedAt: observedAt,
      headSha: null,
      threadId: null,
      state: null,
      actionable: true,
    };
    const failing = facts({
      checks: [
        {
          ...passing,
          state: "failing",
          details: "Expected [] but received null",
        },
      ],
      feedback: [feedback],
    });
    const first = decidePullRequest(failing);
    expect(first.decision.action).toBe("repair");
    expect(first.events).toHaveLength(2);
    expect(first.decision.prompt).toContain("Expected [] but received null");
    expect(first.decision.prompt).toContain(feedback.url);
    const repeat = decidePullRequest(failing, first.newCursor);
    expect(repeat.events).toHaveLength(0);
    expect(repeat.decision.action).toBe("wait");
    expect(
      decidePullRequest(
        {
          ...failing,
          feedback: [{ ...feedback, fingerprint: "comment:1:version2" }],
        },
        first.newCursor,
      ).decision.action,
    ).toBe("repair");
  });

  test("requires resolved threads, review approval, and squash permission", () => {
    expect(
      decidePullRequest(
        facts({
          unresolvedThreads: [
            {
              id: "thread1",
              path: "test.ts",
              line: 1,
              outdated: true,
              comments: [],
            },
          ],
        }),
      ).decision.action,
    ).toBe("wait");
    expect(
      decidePullRequest(facts({ reviewDecision: "CHANGES_REQUESTED" })).decision
        .action,
    ).toBe("wait");
    expect(
      decidePullRequest(
        facts({ rules: { ...facts().rules, approvingReviews: 1 } }),
      ).decision.action,
    ).toBe("wait");
    expect(decidePullRequest(facts({ canMerge: false })).decision.action).toBe(
      "wait",
    );
    expect(
      decidePullRequest(facts({ squashAllowed: false })).decision.action,
    ).toBe("wait");
    expect(
      decidePullRequest(
        facts({ rules: { ...facts().rules, mergeQueue: true } }),
      ).decision.action,
    ).toBe("wait");
    expect(decidePullRequest(facts({ state: "MERGED" })).decision.action).toBe(
      "done",
    );
  });

  test("combines strict branch and ruleset requirements and fails closed on malformed rules", () => {
    const rules = observeRules(
      {
        requiresStatusChecks: true,
        requiresStrictStatusChecks: false,
        requiredStatusChecks: [{ context: "test", app: { databaseId: 42 } }],
        requiresApprovingReviews: true,
        requiredApprovingReviewCount: 1,
        requiresConversationResolution: false,
      },
      [
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: true,
            required_status_checks: [{ context: "lint", integration_id: -1 }],
          },
        },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 2,
            required_review_thread_resolution: true,
            allowed_merge_methods: ["merge"],
          },
        },
      ],
    );
    expect(rules.known).toBe(true);
    expect(rules.strict).toBe(true);
    expect(rules.requiredChecks).toEqual([
      { name: "test", appId: 42 },
      { name: "lint", appId: null },
    ]);
    expect(rules.approvingReviews).toBe(2);
    expect(rules.conversationResolution).toBe(true);
    expect(rules.squashAllowed).toBe(false);
    expect(observeRules(null, null).known).toBe(false);
    expect(
      observeRules(null, [{ type: "required_status_checks", parameters: {} }])
        .known,
    ).toBe(false);
  });
});
