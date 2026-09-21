import { afterEach, expect, spyOn, test } from "bun:test";
import {
  MutationObserver,
  QueryObserver,
  onlineManager,
} from "@tanstack/react-query";
import {
  snapshotSchema,
  settingsSchema,
  autonomySchema,
  projectSchema,
  noteSchema,
  presetSchema,
  gatewayViewSchema,
  githubAccountsSchema,
  taskSchema,
} from "@nerilo/protocol";
import {
  bootstrapQuery,
  createQueryClient,
  queries,
  queryKeys,
} from "@/lib/query-options";
import { applyMutationResult } from "@/lib/mutation-cache";
import { commandOptions } from "@/lib/mutation-options";

const clients: ReturnType<typeof createQueryClient>[] = [];
const mocks: { mockRestore: () => void }[] = [];
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  mocks.splice(0).forEach((mock) => mock.mockRestore());
  onlineManager.setOnline(true);
});
function client() {
  const value = createQueryClient();
  value.setDefaultOptions({
    ...value.getDefaultOptions(),
    queries: { ...value.getDefaultOptions().queries, retryDelay: 0 },
  });
  clients.push(value);
  return value;
}
function respond(
  callback: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  mocks.push(
    spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
          callback(String(input), init),
        { preconnect: fetch.preconnect },
      ),
    ),
  );
}
function deferred<T>() {
  return Promise.withResolvers<T>();
}
const initial = snapshotSchema.parse({
  projects: [],
  tasks: [],
  presets: [],
  notes: [],
  settings: {},
  sequence: 0,
  runtime: {
    docker: true,
    image: true,
    building: false,
    buildLog: "",
    connections: {
      codex: { ready: false, source: "test", canImport: false },
      claude: { ready: false, source: "test", canImport: false },
    },
  },
});

test("queries deduplicate requests, isolate machines and preserve unchanged references", async () => {
  const cache = client();
  const response = deferred<Response>();
  const urls: string[] = [];
  respond((url) => {
    urls.push(url);
    return response.promise;
  });
  const first = cache.fetchQuery(queries.snapshot("local"));
  const second = cache.fetchQuery(queries.snapshot("local"));
  expect(urls).toEqual(["/api/snapshot?machine=local"]);
  response.resolve(Response.json(initial));
  expect(await first).toBe(await second);
  const before = cache.getQueryData(queries.snapshot("local").queryKey)!;
  respond((url) => {
    urls.push(url);
    return Response.json({ ...initial, sequence: 1 });
  });
  await cache.fetchQuery({ ...queries.snapshot("local"), staleTime: 0 });
  const updated = cache.getQueryData(queries.snapshot("local").queryKey)!;
  expect(updated.settings).toBe(before.settings);
  expect(updated.tasks).toBe(before.tasks);
  expect(updated.sequence).toBe(1);
  const remote = await cache.fetchQuery(queries.snapshot("remote"));
  expect(remote).not.toBe(updated);
  const retained = cache.getQueryData(queries.snapshot("local").queryKey);
  expect(retained).toBe(updated);
  expect(urls.at(-1)).toBe("/api/snapshot?machine=remote");
});

test("navigation cancels the previous resource without delaying the next one", async () => {
  const cache = client();
  let oldSignal: AbortSignal | null | undefined;
  const old = deferred<Response>();
  respond((url, init) => {
    if (url.includes("tasks/old/")) {
      oldSignal = init?.signal;
      return old.promise;
    }
    return Response.json(null);
  });
  const observer = new QueryObserver(cache, queries.autonomy("remote", "old"));
  const stop = observer.subscribe(() => {});
  observer.setOptions(queries.autonomy("remote", "next"));
  expect(oldSignal?.aborted).toBe(true);
  await expect(
    cache.fetchQuery(queries.autonomy("remote", "next")),
  ).resolves.toBeNull();
  old.resolve(Response.json(null));
  expect(
    cache.getQueryData(queries.autonomy("remote", "old").queryKey),
  ).toBeUndefined();
  stop();
});

test("accepted partial settings saves survive failed revalidation and preserve other fields", async () => {
  const cache = client();
  let saved = initial.settings;
  const bodies: unknown[] = [];
  cache.setQueryData(queryKeys.snapshot("local"), initial);
  respond((_url, init) => {
    if (init?.method === "POST") {
      const input: unknown = JSON.parse(String(init.body));
      bodies.push(input);
      saved = settingsSchema.parse({
        ...saved,
        ...(input && typeof input === "object" ? input : {}),
      });
      return Response.json(saved);
    }
    return Response.json({ error: "Snapshot unavailable" }, { status: 503 });
  });
  const observer = new QueryObserver(cache, queries.snapshot("local"));
  const stop = observer.subscribe(() => {});
  const command = new MutationObserver(
    cache,
    commandOptions(cache, "local", "settings"),
  );
  await command.mutate({ path: "settings", body: { appearance: "dark" } });
  expect(command.getCurrentResult().status).toBe("success");
  expect(observer.getCurrentResult().error?.message).toBe(
    "Snapshot unavailable",
  );
  expect(observer.getCurrentResult().data?.settings.appearance).toBe("dark");
  await command.mutate({ path: "settings", body: { concurrency: 3 } });
  expect(bodies).toEqual([{ appearance: "dark" }, { concurrency: 3 }]);
  expect(observer.getCurrentResult().data?.settings).toMatchObject({
    appearance: "dark",
    concurrency: 3,
  });
  stop();
});

test("a poll started during an Autopilot save cannot overwrite its accepted result", async () => {
  const cache = client();
  const response = deferred<Response>();
  const started = deferred<void>();
  const oldRead = deferred<Response>();
  let pollSignal: AbortSignal | null | undefined;
  respond((_url, init) => {
    if (init?.method === "POST") {
      started.resolve();
      return response.promise;
    }
    pollSignal = init?.signal;
    return oldRead.promise;
  });
  const command = new MutationObserver(
    cache,
    commandOptions(cache, "local", "task:a"),
  );
  const save = command.mutate({
    path: "tasks/a/autonomy",
    body: { mode: "pr", base: "main" },
  });
  await started.promise;
  const poll = cache
    .fetchQuery(queries.autonomy("local", "a"))
    .catch(() => null);
  const autonomy = autonomySchema.parse({
    taskId: "a",
    mode: "pr",
    status: "waiting",
    branch: "work",
    base: "main",
    prUrl: null,
    detail: "Waiting",
    repairTurns: 0,
    updatedAt: new Date().toISOString(),
  });
  response.resolve(Response.json(autonomy));
  await save;
  expect(pollSignal?.aborted).toBe(true);
  oldRead.resolve(Response.json(null));
  await poll;
  const retained = cache.getQueryData(queries.autonomy("local", "a").queryKey);
  expect(retained).toEqual(autonomy);
});

test("local queries work offline and failed commands are never automatically retried", async () => {
  const cache = client();
  onlineManager.setOnline(false);
  let writes = 0;
  respond((_url, init) => {
    if (init?.method === "POST") {
      writes++;
      throw new TypeError("Disconnected");
    }
    return Response.json(initial);
  });
  await expect(cache.fetchQuery(queries.snapshot("local"))).resolves.toEqual(
    initial,
  );
  const command = new MutationObserver(cache, commandOptions(cache, "local"));
  await expect(
    command.mutate({ path: "tasks/a/git", body: { action: "push" } }),
  ).rejects.toThrow("Disconnected");
  expect(writes).toBe(1);
});

test("commands sharing an entity scope execute in order", async () => {
  const cache = client();
  const firstResponse = deferred<Response>();
  const firstStarted = deferred<void>();
  const writes: unknown[] = [];
  respond((_url, init) => {
    writes.push(JSON.parse(String(init?.body)));
    if (writes.length === 1) {
      firstStarted.resolve();
      return firstResponse.promise;
    }
    return Response.json(
      settingsSchema.parse({ appearance: "dark", concurrency: 3 }),
    );
  });
  const first = new MutationObserver(
    cache,
    commandOptions(cache, "local", "settings"),
  );
  const second = new MutationObserver(
    cache,
    commandOptions(cache, "local", "settings"),
  );
  const saveTheme = first.mutate({
    path: "settings",
    body: { appearance: "dark" },
  });
  await firstStarted.promise;
  const saveConcurrency = second.mutate({
    path: "settings",
    body: { concurrency: 3 },
  });
  expect(writes).toHaveLength(1);
  firstResponse.resolve(
    Response.json(settingsSchema.parse({ appearance: "dark" })),
  );
  await Promise.all([saveTheme, saveConcurrency]);
  expect(writes).toEqual([{ appearance: "dark" }, { concurrency: 3 }]);
});

test("authentication failures are reported without retrying", async () => {
  const cache = client();
  let reads = 0;
  respond(() => {
    reads++;
    return Response.json({ error: "Reconnect" }, { status: 401 });
  });
  await expect(cache.fetchQuery(queries.snapshot("local"))).rejects.toThrow(
    "Reconnect",
  );
  expect(reads).toBe(1);
});

test("bootstrap seeds an empty workspace but reconnect cannot overwrite a newer save", async () => {
  const cache = client();
  const reconnect = deferred<Response>();
  const started = deferred<void>();
  let bootstraps = 0;
  respond((_url, init) => {
    if (init?.method === "POST")
      return Response.json({ ...initial.settings, appearance: "dark" });
    if (++bootstraps === 1) return Response.json(initial);
    started.resolve();
    return reconnect.promise;
  });
  await cache.fetchQuery(bootstrapQuery(cache, "local"));
  const seeded = cache.getQueryData(queries.snapshot("local").queryKey);
  expect(seeded).toEqual(initial);
  const connecting = cache.fetchQuery({
    ...bootstrapQuery(cache, "local"),
    staleTime: 0,
  });
  await started.promise;
  const command = new MutationObserver(
    cache,
    commandOptions(cache, "local", "settings"),
  );
  await command.mutate({ path: "settings", body: { appearance: "dark" } });
  const saved = cache.getQueryData(queries.snapshot("local").queryKey);
  reconnect.resolve(Response.json(initial));
  await connecting;
  const retained = cache.getQueryData(queries.snapshot("local").queryKey);
  expect(retained).toBe(saved);
  expect(retained?.settings.appearance).toBe("dark");
});

const project = projectSchema.parse({
  id: "project",
  name: "Project",
  path: "/tmp/example",
  branch: "main",
  createdAt: "2026-09-19T00:00:00Z",
});
const note = noteSchema.parse({
  id: "note",
  title: "Note",
  content: "Context",
  projectId: null,
  updatedAt: "2026-09-19T00:00:00Z",
});
const preset = presetSchema.parse({
  id: "preset",
  name: "Preset",
  provider: "codex",
  model: "",
  instructions: "Be helpful",
});

test.each([
  {
    resource: "projects" as const,
    created: project,
    updated: { ...project, name: "Renamed project" },
  },
  {
    resource: "notes" as const,
    created: note,
    updated: { ...note, title: "Renamed note" },
  },
  {
    resource: "presets" as const,
    created: preset,
    updated: { ...preset, name: "Renamed preset" },
  },
])(
  "accepted $resource creates and edits survive a failed snapshot refresh",
  async ({ resource, created, updated }) => {
    const cache = client();
    cache.setQueryData(queryKeys.snapshot("local"), initial);
    respond((url, init) =>
      init?.method === "POST"
        ? Response.json(url.includes(`/${created.id}?`) ? updated : created)
        : Response.json({ error: "Snapshot unavailable" }, { status: 503 }),
    );
    const observer = new QueryObserver(cache, queries.snapshot("local"));
    const stop = observer.subscribe(() => {});
    const command = new MutationObserver(cache, commandOptions(cache, "local"));
    await command.mutate({ path: resource, body: created });
    expect(observer.getCurrentResult().data?.[resource]).toHaveLength(1);
    expect(observer.getCurrentResult().data?.[resource][0]).toEqual(created);
    await command.mutate({ path: `${resource}/${created.id}`, body: updated });
    expect(observer.getCurrentResult().data?.[resource]).toHaveLength(1);
    expect(observer.getCurrentResult().data?.[resource][0]).toEqual(updated);
    expect(command.getCurrentResult().status).toBe("success");
    stop();
  },
);

test("accepted gateway saves remain available when its next read fails", async () => {
  const cache = client();
  const original = gatewayViewSchema.parse({
    baseUrl: "https://gateway.example.com",
    model: "before",
    credential: {
      type: "environment",
      variable: "FIXTURE_KEY",
      configured: true,
    },
    headerNames: [],
    hasCertificate: false,
  });
  const saved = { ...original, model: "after" };
  cache.setQueryData(queries.gateway("local", "codex").queryKey, original);
  respond((_url, init) =>
    init?.method === "POST"
      ? Response.json(saved)
      : Response.json({ error: "Gateway unavailable" }, { status: 503 }),
  );
  const observer = new QueryObserver(cache, queries.gateway("local", "codex"));
  const stop = observer.subscribe(() => {});
  const command = new MutationObserver(
    cache,
    commandOptions(cache, "local", "connection:codex"),
  );
  await command.mutate({
    path: "connections/codex/gateway",
    body: { model: "after" },
  });
  expect(observer.getCurrentResult().error?.message).toBe(
    "Gateway unavailable",
  );
  expect(observer.getCurrentResult().data?.model).toBe("after");
  expect(command.getCurrentResult().status).toBe("success");
  stop();
});

test("GitHub switches update the selected machine and invalidate its GitHub data even if revalidation fails", async () => {
  const cache = client();
  const before = githubAccountsSchema.parse({
    hosts: [
      {
        hostname: "github.com",
        environmentToken: null,
        accounts: [
          { login: "personal", active: true, state: "success" },
          { login: "work", active: false, state: "success" },
        ],
      },
    ],
  });
  const after = {
    hosts: before.hosts.map((host) => ({
      ...host,
      accounts: host.accounts.map((account) => ({
        ...account,
        active: account.login === "work",
      })),
    })),
  };
  const selected = queries.githubAccounts("remote");
  cache.setQueryData(selected.queryKey, before);
  cache.setQueryData(queries.githubAccounts("local").queryKey, before);
  const remotePRs = queries.pullRequests("remote", "project").queryKey;
  const localPRs = queries.pullRequests("local", "project").queryKey;
  cache.setQueryData(remotePRs, {
    repository: null,
    pullRequests: [],
    limited: false,
  });
  cache.setQueryData(localPRs, {
    repository: null,
    pullRequests: [],
    limited: false,
  });
  const urls: string[] = [];
  respond((url, init) => {
    urls.push(url);
    return init?.method === "POST"
      ? Response.json(after)
      : Response.json({ error: "GitHub unavailable" }, { status: 400 });
  });
  const observer = new QueryObserver(cache, selected);
  const stop = observer.subscribe(() => {});
  const command = new MutationObserver(
    cache,
    commandOptions(cache, "remote", "github-account"),
  );
  await command.mutate({
    path: "connections/github/switch",
    body: { hostname: "github.com", login: "work" },
  });
  expect(urls).toEqual([
    "/api/connections/github/switch?machine=remote",
    "/api/connections/github?machine=remote",
  ]);
  expect(observer.getCurrentResult().data).toEqual(after);
  expect(observer.getCurrentResult().error?.message).toBe("GitHub unavailable");
  expect(command.getCurrentResult().status).toBe("success");
  expect(
    cache.getQueryData(queries.githubAccounts("local").queryKey),
  ).toMatchObject(before);
  expect(cache.getQueryState(remotePRs)?.isInvalidated).toBe(true);
  expect(cache.getQueryState(localPRs)?.isInvalidated).toBe(false);
  stop();
});

test("accepted removals clear retained records and dependent task caches only on their machine", () => {
  const cache = client();
  const task = taskSchema.parse({
    id: "task",
    projectId: project.id,
    title: "Task",
    provider: "codex",
    presetId: preset.id,
    model: "",
    status: "ready",
    sessionId: null,
    baseCommit: null,
    includeChanges: false,
    pending: [],
    activeTurnId: null,
    createdAt: "2026-09-19T00:00:00Z",
    updatedAt: "2026-09-19T00:00:00Z",
    archived: false,
    error: null,
    stopRequested: false,
  });
  const snapshot = {
    ...initial,
    projects: [project],
    tasks: [task],
    presets: [preset],
    notes: [note, { ...note, id: "project-note", projectId: project.id }],
    settings: {
      ...initial.settings,
      sidebarOrder: {
        projects: [project.id],
        tasks: { [project.id]: [task.id] },
      },
    },
  };
  cache.setQueryData(queryKeys.snapshot("local"), snapshot);
  cache.setQueryData(queries.autonomy("local", task.id).queryKey, null);
  cache.setQueryData(queries.autonomy("remote", task.id).queryKey, null);
  applyMutationResult(
    cache,
    "local",
    `notes/${note.id}`,
    { ok: true },
    { remove: true },
  );
  applyMutationResult(
    cache,
    "local",
    `presets/${preset.id}`,
    { ok: true },
    { remove: true },
  );
  applyMutationResult(cache, "local", `projects/${project.id}/delete`, {
    ok: true,
  });
  const retained = cache.getQueryData(queries.snapshot("local").queryKey);
  expect(retained).toMatchObject({
    projects: [],
    tasks: [],
    notes: [],
    presets: [],
    settings: { sidebarOrder: { projects: [], tasks: {} } },
  });
  expect(
    cache.getQueryState(queries.autonomy("local", task.id).queryKey),
  ).toBeUndefined();
  expect(
    cache.getQueryState(queries.autonomy("remote", task.id).queryKey),
  ).toBeDefined();
});

test("incompatible snapshot data keeps the last good view and stops retrying until the app reloads", async () => {
  const cache = client();
  const options = queries.snapshot("local");
  cache.setQueryData(options.queryKey, initial);
  let reads = 0;
  respond(() => {
    reads++;
    return Response.json({
      ...initial,
      presets: [{ ...preset, provider: "future-provider" }],
    });
  });
  await expect(cache.fetchQuery({ ...options, staleTime: 0 })).rejects.toThrow(
    "Reload the app",
  );
  expect(reads).toBe(1);
  const retained = cache.getQueryData<typeof initial>(options.queryKey);
  expect(retained).toEqual(initial);
  const failed = cache.getQueryState(options.queryKey)!;
  expect(options.refetchInterval({ state: { error: failed.error } })).toBe(
    false,
  );
  expect(
    options.refetchInterval({ state: { error: new TypeError("Offline") } }),
  ).toBe(5_000);
  await expect(
    cache.fetchQuery(bootstrapQuery(cache, "new-machine")),
  ).rejects.toThrow("Reload the app");
  expect(reads).toBe(2);
  expect(
    cache.getQueryData(queries.snapshot("new-machine").queryKey),
  ).toBeUndefined();
});
