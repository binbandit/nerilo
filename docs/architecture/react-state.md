# React state ownership

Nerilo uses TanStack Query for daemon data, the URL for navigation, and React state for local interaction. The browser talks to the existing Next.js proxy; daemon requests still validate responses with the protocol schemas. The workspace is a live client application, so Server Actions or a second server-rendered cache would add another reconciliation boundary here.

## Daemon data

`apps/web/src/lib/query-options.ts` defines resource keys, validated readers, retention, polling, and retry policies. Every machine resource includes an explicit machine ID in both its key and request. The machine registry belongs to the local web host and has its own key.

`QueryProvider` creates one client per mounted workspace, with no module-level server cache. Bootstrap establishes the browser session and seeds an empty snapshot cache before protected queries become enabled. Reconnecting never replaces an existing snapshot with bootstrap data: a delayed bootstrap response could otherwise overwrite a newer accepted command. Snapshot and selected-task queries then load independently. Visiting another task cancels the abandoned read and subscribes to that task's cache entry.

Use `useQuery(queries.resource(...))` for ordinary reads. Query functions consume the abort signal. Cached data stays visible during background failures, and unchanged JSON retains shared references. Show query errors alongside usable cached data; avoid replacing a whole screen with a loader during revalidation.

| Resource                                | Freshness / retention                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| Workspace snapshot, selected task       | 5-second stale time and reconciliation polling                                  |
| Autopilot                               | 7-second polling                                                                |
| Machine registry, project pull requests | 30-second stale time and polling                                                |
| Model catalog                           | 5-minute stale time                                                             |
| State summary                           | Keyed by task and turn, with 5-second polling                                   |
| Files and previews                      | Keyed by task, turn/status revision and path; explicit refresh and invalidation |
| Gateway profile, folders                | Shared cached reads; editable values become local form drafts                   |

Most inactive entries expire after five minutes; file previews and summaries expire after one minute. Query retries are limited to two retries for network failures and HTTP 5xx errors. Authentication and validation errors surface immediately. Requests use `networkMode: "always"` because a local daemon can remain reachable without internet connectivity.

One event stream invalidates the selected machine's cached resources. The daemon's event sequence is coarse and does not cover every settings/runtime change, so polling remains necessary. Event invalidation does not repeatedly cancel an already running read.

## Commands and reconciliation

Use `useApiMutation` for writes. `mutation-options.ts` owns execution and lifecycle; `mutation-cache.ts` maps affected resources and applies authoritative responses. Give commands that target the same task or settings a shared scope when they must execute in order. Keep immediate submission guards for duplicate user actions: serialization does not deduplicate commands.

The shared lifecycle cancels affected reads before a command and again when it succeeds. A poll that started during the write cannot replace its accepted response. Settings, ordering, sandbox defaults, tools, tasks, projects, notes, presets, runtime connections, gateway profiles, and Autopilot update the relevant cache immediately from server results, followed by invalidation. Acknowledged deletions also remove dependent records and cached task/project queries for that machine. Other commands revalidate their affected resources. The lifecycle awaits revalidation; a failed revalidation is a query error and does not turn an accepted command into a rejected save.

Send only fields being changed to `/settings`. Never spread a cached settings object into a patch. Whole-list skill/MCP writes still use the daemon's existing replacement contract; concurrent editing across browsers would require a server revision/conflict contract.

Commands are never automatically retried or persisted for later replay. The API helper preserves idempotency keys for explicit retries of uncertain task submissions. Component completion callbacks should close dialogs, clear drafts, or navigate; they should not pass refresh callbacks through the component tree.

## URL and local state

`features/navigation/route.ts` validates existing hash routes and subscribes through `useSyncExternalStore`. The URL is the source of truth for task, project, and settings-section navigation. Back/Forward and deep links use the same route snapshot. Machine switching remains a full navigation, which resets subscriptions and in-memory caches.

Keep composer drafts, dialog visibility, selection, search, and editable form values local. Persisted drafts use the existing storage subscription and machine-scoped keys. No additional global UI store is needed for the current interactions.

Derive project lists directly from the snapshot. A newly created project enters the shared cache from its accepted response, so the home screen does not need a separate copy to bridge the next poll.

Create form drafts only once the initial data is available. Autopilot and gateway forms mount with loaded values; later polls must not replace typing. Closing and reopening creates a fresh draft. Sidebar reordering retains its existing React optimistic state; the query cache owns the accepted server result, without a second optimistic layer.

Git review deliberately keeps the displayed patch and review token as a local snapshot until an explicit refresh or completed command. Its reader uses the query client, while remote branch checks use shared queries keyed by head and branch. Publishing stays unavailable while the remote check is in flight or does not match the reviewed checkout. Sign-in is a bounded start/poll/cancel workflow with cleanup, not ordinary background data polling.

## Verification

The migration was checked with cache/mutation regression tests and an isolated production preview using an in-memory daemon. Browser checks covered successful partial settings writes while snapshots return 503, settings history, opening a second task while the first read is delayed eight seconds, Autopilot saves, loading a form before its saved data arrives, and switching away from a delayed file preview. Fixtures disable agent execution and use separate ports and temporary data.

The second pass reproduced three additional failures before fixing them: saved notes disappearing during snapshot read failures, gateway forms reopening with old values after a successful save, and delayed reconnect responses overwriting newer settings. The same browser scenarios passed after the fixes, including note creation and editing while subsequent reads return 503.

The final validation passed formatting, React lint, type checking, all 251 tests, theme consistency, and the production build.

Regression tests cover shared request deduplication, machine isolation, reference preservation, cancellation, accepted writes with failed revalidation, stale Autopilot polls, serialized commands, offline local reads, and retry policy. Additional coverage checks bootstrap seeding and reconnect races, project/note/preset creates and edits, gateway saves, and removal of dependent cache entries on the correct machine. See `apps/web/src/lib/query-state.test.ts` and `features/navigation/route.test.ts`.

The implementation follows the [TanStack cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) and [mutation](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) guidance and React's [guidance on avoiding unnecessary effects](https://react.dev/learn/you-might-not-need-an-effect).
