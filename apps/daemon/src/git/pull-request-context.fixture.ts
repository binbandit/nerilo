export const head = "a".repeat(40);
export const target = "b".repeat(40);
export const url = "https://github.com/example/repo/pull/4";
const raw = {
  url,
  number: 4,
  title: "Prioritize tickets",
  author: { login: "contributor" },
  state: "OPEN",
  isDraft: false,
  reviewDecision: "CHANGES_REQUESTED",
  mergeable: "CONFLICTING",
  headRefName: "feature",
  baseRefName: "main",
  headRefOid: head,
  headRepository: { nameWithOwner: "example/repo" },
  statusCheckRollup: [],
};
const note = (body: string) => ({
  body,
  url: `${url}#discussion`,
  author: { login: "reviewer" },
  commit: { oid: head },
});
export const page = (field: string, nodes: unknown[], revision = head) => ({
  data: {
    repository: { pullRequest: { headRefOid: revision, [field]: { nodes } } },
  },
});

export function contextFixture() {
  let reviewBody = "Normalize unknown priorities.";
  const calls: string[][] = [];
  return {
    setReview: (body: string) => {
      reviewBody = body;
    },
    calls,
    checked: async (args: string[]) => {
      calls.push(args);
      if (args[1] === "pr") return JSON.stringify(raw);
      if (args.some((value) => value.includes("git/ref/heads/"))) return target;
      const query = args.find((value) => value.startsWith("query=")) ?? "";
      if (query.includes("node(id:"))
        return JSON.stringify([
          {
            data: {
              node: { comments: { nodes: [note("First inline request.")] } },
            },
          },
          {
            data: {
              node: {
                comments: { nodes: [note("Follow-up after the first page.")] },
              },
            },
          },
        ]);
      if (query.includes("reviewThreads"))
        return JSON.stringify([
          page("reviewThreads", [
            {
              id: "thread",
              path: "src/queue.mjs",
              line: 8,
              isResolved: false,
              isOutdated: true,
              comments: {
                nodes: [note("First inline request.")],
                pageInfo: { hasNextPage: true },
              },
            },
            {
              id: "resolved",
              path: "src/queue.mjs",
              line: 1,
              isResolved: true,
              isOutdated: false,
              comments: {
                nodes: [note("Already resolved.")],
                pageInfo: { hasNextPage: false },
              },
            },
          ]),
        ]);
      if (query.includes("reviews"))
        return JSON.stringify([
          page("reviews", [
            {
              ...note(reviewBody),
              state: "CHANGES_REQUESTED",
              submittedAt: "2026-09-20T00:00:00Z",
            },
          ]),
          page("reviews", [
            {
              ...note("Unsubmitted draft."),
              state: "PENDING",
              submittedAt: null,
            },
          ]),
        ]);
      return JSON.stringify([
        page("comments", [note("Preserve title trimming.")]),
      ]);
    },
  };
}
