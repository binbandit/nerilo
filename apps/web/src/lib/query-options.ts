import { QueryClient, queryOptions } from "@tanstack/react-query";
import {
  autonomySchema,
  detailSchema,
  folderListingSchema,
  gatewayViewSchema,
  githubAccountsSchema,
  gitRemoteStatusSchema,
  gitStatusSchema,
  pullRequestTemplatesSchema,
  machinesSchema,
  modelCatalogSchema,
  projectPullRequestsSchema,
  pullRequestContextSchema,
  snapshotSchema,
  workspaceFileSchema,
  workspaceFilesSchema,
  stateSummarySchema,
  type Provider,
  type PullRequestListState,
  type GithubAccountSelection,
  type Snapshot,
  type Task,
} from "@nerilo/protocol";
import { ApiError, read } from "@/lib/api";
import { needsAppReload, parseApiResponse } from "@/lib/response-schema";

export const queryKeys = {
  machine: (machine: string) => ["machine", machine] as const,
  snapshot: (machine: string) => ["machine", machine, "snapshot"] as const,
  task: (machine: string, id: string) =>
    ["machine", machine, "tasks", id] as const,
  registry: ["machine-registry"] as const,
};

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Localhost remains reachable when the browser reports no internet.
        networkMode: "always",
        staleTime: 5_000,
        gcTime: 5 * 60_000,
        retry: (attempt, error) =>
          attempt < 2 &&
          (error instanceof TypeError ||
            (error instanceof ApiError && error.status >= 500)),
        refetchOnReconnect: (query) => !needsAppReload(query.state.error),
        refetchOnWindowFocus: (query) => !needsAppReload(query.state.error),
      },
      mutations: { retry: false, networkMode: "always" },
    },
  });
}

export function bootstrapQuery(client: QueryClient, machine: string) {
  return queryOptions({
    queryKey: ["bootstrap", machine],
    queryFn: async ({ signal }) => {
      const snapshot = parseApiResponse(
        snapshotSchema.parse,
        await read("bootstrap", signal, machine),
      );
      // Bootstrap establishes the session. Reconnect must not replace a newer
      // mutation result with the snapshot captured when bootstrap started.
      const key = queryKeys.snapshot(machine);
      if (client.getQueryData(key) === undefined)
        client.setQueryData<Snapshot>(key, snapshot);
      return true;
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.status === "error" && !needsAppReload(query.state.error)
        ? 5_000
        : false,
  });
}

function resource<T>(
  machine: string,
  path: string,
  key: readonly string[],
  parse: (value: unknown) => T,
) {
  return queryOptions({
    queryKey: key,
    queryFn: async ({ signal }) =>
      parseApiResponse(parse, await read(path, signal, machine)),
  });
}

function pollEvery(milliseconds: number) {
  return (query: { state: { error: Error | null } }) =>
    needsAppReload(query.state.error) ? false : milliseconds;
}

export const queries = {
  gitTemplates: (machine: string, id: string, head: string) =>
    resource(
      machine,
      `tasks/${id}/git/templates`,
      [...queryKeys.task(machine, id), "git", "templates", head],
      pullRequestTemplatesSchema.parse,
    ),
  githubAccounts: (machine: string) => ({
    ...resource(
      machine,
      "connections/github",
      [...queryKeys.machine(machine), "connections", "github"],
      githubAccountsSchema.parse,
    ),
    staleTime: 30_000,
  }),
  snapshot: (machine: string) => ({
    ...resource(
      machine,
      "snapshot",
      queryKeys.snapshot(machine),
      snapshotSchema.parse,
    ),
    refetchInterval: pollEvery(5_000),
  }),
  task: (machine: string, id: string) => ({
    ...resource(
      machine,
      `tasks/${id}`,
      [...queryKeys.task(machine, id), "detail"],
      detailSchema.parse,
    ),
    refetchInterval: pollEvery(5_000),
  }),
  machines: () => ({
    ...resource("local", "machines", queryKeys.registry, machinesSchema.parse),
    staleTime: 30_000,
    refetchInterval: pollEvery(30_000),
  }),
  models: (machine: string) => ({
    ...resource(
      machine,
      "models",
      [...queryKeys.machine(machine), "models"],
      modelCatalogSchema.parse,
    ),
    staleTime: 5 * 60_000,
  }),
  autonomy: (machine: string, id: string) => ({
    ...resource(
      machine,
      `tasks/${id}/autonomy`,
      [...queryKeys.task(machine, id), "autonomy"],
      autonomySchema.nullable().parse,
    ),
    refetchInterval: pollEvery(7_000),
  }),
  pullRequests: (
    machine: string,
    id: string,
    state: PullRequestListState = "open",
  ) => ({
    ...resource(
      machine,
      `projects/${id}/pull-requests?state=${state}`,
      [...queryKeys.machine(machine), "projects", id, "pull-requests", state],
      projectPullRequestsSchema.parse,
    ),
    staleTime: 30_000,
    refetchInterval: pollEvery(30_000),
  }),
  pullRequestContext: (
    machine: string,
    id: string,
    url: string,
    account: GithubAccountSelection | null | undefined,
  ) => ({
    ...resource(
      machine,
      `projects/${id}/pull-requests/context?${new URLSearchParams({ url, ...(account ? { login: account.login } : {}) })}`,
      [
        ...queryKeys.machine(machine),
        "projects",
        id,
        "pull-request-context",
        url,
        account?.login ?? "",
      ],
      pullRequestContextSchema.parse,
    ),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  }),
  files: (machine: string, id: string, revision: string) =>
    resource(
      machine,
      `tasks/${id}/files`,
      [...queryKeys.task(machine, id), "files", revision],
      workspaceFilesSchema.parse,
    ),
  file: (machine: string, id: string, revision: string, path: string) => ({
    ...resource(
      machine,
      `tasks/${id}/file?path=${encodeURIComponent(path)}`,
      [...queryKeys.task(machine, id), "file", revision, path],
      workspaceFileSchema.parse,
    ),
    gcTime: 60_000,
  }),
  folders: (machine: string, path?: string) =>
    resource(
      machine,
      path === undefined
        ? "folders"
        : `folders?path=${encodeURIComponent(path)}`,
      [...queryKeys.machine(machine), "folders", path ?? ""],
      folderListingSchema.parse,
    ),
  summary: (
    machine: string,
    id: string,
    turn: string,
    status: Task["status"],
  ) => ({
    ...resource(
      machine,
      `tasks/${id}/state-summary`,
      [...queryKeys.task(machine, id), "summary", turn, status],
      stateSummarySchema.parse,
    ),
    refetchInterval: pollEvery(5_000),
    gcTime: 60_000,
  }),
  gateway: (machine: string, provider: Provider) =>
    resource(
      machine,
      `connections/${provider}/gateway`,
      [...queryKeys.machine(machine), "connections", provider, "gateway"],
      gatewayViewSchema.nullable().parse,
    ),
  git: (machine: string, id: string) =>
    resource(
      machine,
      `tasks/${id}/git`,
      [...queryKeys.task(machine, id), "git"],
      gitStatusSchema.parse,
    ),
  gitRemote: (machine: string, id: string, head: string, branch: string) =>
    resource(
      machine,
      `tasks/${id}/git/remote`,
      [...queryKeys.task(machine, id), "git-remote", head, branch],
      (value) => {
        const result = gitRemoteStatusSchema.parse(value);
        if (result.head !== head || result.branch !== branch)
          throw new Error(
            "The checkout changed. Refresh changes to compare its current branch.",
          );
        return result;
      },
    ),
};
