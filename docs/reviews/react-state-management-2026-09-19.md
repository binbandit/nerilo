# React state management review, 19 September 2026

Recommendation: adopt TanStack Query for daemon data and mutations, make navigation state belong to the URL, and keep form drafts and transient UI state local to React. Consider a small Zustand store only if shared UI controls remain awkward after those changes. Moving everything into a global store would preserve most of the current complexity.

This records the assessment before migration. The approved implementation is now documented in [React state ownership](../architecture/react-state.md); findings below describe the earlier code. The earlier React cleanup improved individual components; this pass examines ownership and synchronization across components.

## Scope and evidence

Surveyed state declarations, contexts, subscriptions, request helpers, reads, mutations, refresh callbacks, and persistence across the web app and theme preview. Traced the root page, machine provider, home composer, task/review flows, sidebar, settings, editors, and their daemon contracts. Used the Vercel React Best Practices skill, the installed Next.js 16.3.5 documentation, and current primary documentation for TanStack Query, SWR, and Zustand.

The other Nerilo tasks were idle. Browser verification reused the isolated production build with an in-memory fixture daemon on ports 5385/5386. The fixture disabled agent execution and simulated snapshot failures while allowing settings writes. No daily-driver data, provider runs, or project files were used for those writes. Both preview processes were stopped afterward.

The settings overwrite below was reproduced in the browser. The remaining findings come from source inspection; performance implications have not been profiled or benchmarked.

## Findings, in priority order

### 1. Settings saves can overwrite unrelated changes

[Manage](../../apps/web/src/features/settings/manage.tsx) sends `{ ...data.settings, ...input }`, and [keyboard settings wiring](../../apps/web/src/features/settings/settings-panel.tsx) also sends the entire settings snapshot. The [daemon endpoint](../../apps/daemon/src/http/settings-routes.ts) already supports merging a partial update into current settings. Sending stale values defeats that merge for appearance, concurrency, and keybindings.

Browser reproduction:

1. Start with appearance `light` and concurrency `2`.
2. Choose Warm dark. The write succeeds; deliberately fail subsequent snapshot reads.
3. Open Environment and choose concurrency `3`.
4. The second request includes the old `appearance: light`. The daemon ends with concurrency `3` and appearance `light`, silently undoing the successful theme change.

Send only changed fields. Apply the authoritative mutation response to the shared cache immediately, and revalidate afterward. Distinguish a rejected write from a successful write whose refresh failed. A query library alone does not fix oversized mutation payloads. Whole-list skill and MCP updates also merit explicit conflict handling if simultaneous editors must be supported.

### 2. One refresh queue couples unrelated resources and slows task navigation

In [page.tsx](../../apps/web/src/app/page.tsx), `load()` awaits the full snapshot before requesting the selected task. The same queue handles navigation, a five-second timer, live events, and most mutation completion callbacks. A slow task read can delay the next task's request, even though the stale result is correctly prevented from replacing the selected task. The top-level readers do not accept abort signals.

The snapshot includes runtime checks, settings, projects, tasks, presets, and notes. Runtime inspection can itself wait for Docker checks. Task navigation therefore depends on work that is not necessary to identify or fetch that task.

Give the snapshot and each task detail independent query identities. After session bootstrap, independent reads should run concurrently. Preserve the bootstrap dependency: the proxy establishes the browser cookie through `/bootstrap`; blindly parallelizing all initial requests would introduce unauthorized requests.

Navigation currently refreshes directly and also causes a `hashchange` refresh. Coalescing bounds overlap, but can still schedule a trailing refresh. One navigation owner plus query subscriptions removes the need for that coordination.

### 3. The custom query helper has reached its architectural limit

`useApiQuery` (removed by the migration) handles cancellation and request identity, but its state belongs to one mounted hook. It does not share results or in-flight requests between consumers, retain visited results across unmounts, or provide central invalidation and retry policies. On a failed refresh it replaces previously usable data with `null`.

Examples include model catalogs, project pull requests, and file previews. Model catalogs are requested by each mounted picker. Project PR data refreshes on mount or its refresh button, independently of the root's refresh policy. These are reasonable first implementations, but every new resource now needs its own freshness decisions.

Replace the helper with resource-specific query options and hooks backed by a shared cache. Avoid building a second custom cache framework on top of the library. The helper added during the earlier cleanup should be removed after its callers migrate.

### 4. Mutation completion and reconciliation have inconsistent meanings

[TaskView](../../apps/web/src/features/tasks/task-view.tsx), [TaskQueue](../../apps/web/src/features/tasks/task-queue.tsx), [Manage](../../apps/web/src/features/settings/manage.tsx), and other components repeat pending flags, errors, request guards, writes, and refresh callbacks. Many refresh props are typed as returning `void`, while the root actually returns a promise. Some callers await refresh; others clear pending state before refreshed data arrives. The root catches refresh errors, so awaiting it does not establish that reconciliation succeeded.

Use domain mutation hooks to own response parsing, cache updates, invalidation, and status. Components should handle local actions such as closing a dialog or clearing a submitted draft. Preserve immediate duplicate-submit guards where needed: a mutation hook does not inherently deduplicate commands or serialize all writes to the same task.

Keep the existing idempotency behavior in [api.ts](../../apps/web/src/lib/api.ts). An uncertain response can follow a successful task submission. Do not add automatic retries or offline replay to task, Git, login, or agent commands without preserving their individual semantics. Apply optimistic updates to reversible settings/order changes; execution, checkout, push, and publish results require server confirmation.

### 5. Live updates need a defined contract before polling can shrink

The [event stream](../../apps/daemon/src/http/events.ts) publishes only a global event sequence, not an affected task or resource. The root consequently refreshes the snapshot and selected task for every change. Settings writes do not necessarily create an event; the browser reproduction left the event sequence unchanged across both successful saves. Runtime state can also change independently of that sequence.

Initially keep reconciliation polling while moving it under the query layer. Retain one stream per selected machine and invalidate the resources its current coarse signal can actually justify. Deduplicate invalidations during bursts and revalidate after reconnect or visibility changes.

A later daemon change can publish resource identities and a revision covering all relevant writes. Only then reduce broad polling safely. Do not treat the existing event sequence as a version of the entire snapshot. Large conversations may eventually need incremental events or pagination; a client library will not reduce the size of the current full-detail response by itself.

### 6. Autopilot reads can race with saves

[TaskAutonomy](../../apps/web/src/features/tasks/task-autonomy.tsx) polls every seven seconds without cancellation or an in-flight guard. The lifecycle flag prevents writes after unmount, but does not prevent an earlier poll from completing after a later poll or save and replacing the newer value. Read errors are silently ignored.

Move this resource into the query cache. Cancel or otherwise order outstanding reads around a mutation, populate from the save response, and then invalidate. Retain a visible distinction between known saved state and an unavailable status check. This race is supported by the source ordering, but was not separately reproduced in the browser during this review.

### 7. Navigation has competing owners

The root keeps both `route` state and a selected-route ref alongside `window.location.hash`. [SettingsPanel](../../apps/web/src/features/settings/settings-panel.tsx) initializes its section from the route, then keeps it locally. In the browser, opening Environment while on `#settings/appearance` left the URL pointing at Appearance. A reload therefore cannot restore the visible section from that URL.

Use the URL for selected machine, project/task, and settings section. Task tabs and selected file can also be URL state when deep-linking and history are desirable. Keep hover, dialog visibility, drag state, input text, and focus refs out of the URL.

Next App Router routes and search parameters are a good eventual owner. Preserve old hash links through a compatibility transition. Routing migration can follow the query migration; it is not a prerequisite. A typed hash-route adapter is a smaller interim improvement if retaining current URLs.

### 8. Broad subscriptions prevent useful isolation

Each parsed snapshot and detail read produces fresh object identities. The root forwards broad objects into feature trees, and keyboard preferences receive a fresh nested settings object. The memoized machine context still changes when polling returns a newly parsed machine array. This creates avoidable render opportunities even when a consumer's relevant data is unchanged.

Query structural sharing and selectors can preserve unchanged values. Subscribe near the component that needs the data, and pass narrow props to presentation components. Simply putting the current snapshot in one large Context or Zustand subscription would not solve this. Measure with React profiling before adding further memoization or claiming a particular speed improvement.

## Recommended ownership

| State                             | Current examples                                                                             | Recommended owner                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Daemon records and runtime status | Snapshot, task details, models, PRs, Autopilot, Git status, files                            | TanStack Query, scoped by machine and resource                                                       |
| Local machine registry            | `MachineProvider` polling and retries                                                        | A registry query; keep machine selection/navigation separate                                         |
| Durable user preferences          | Appearance, shortcuts, sandbox defaults, sidebar order                                       | Daemon remains authoritative; query cache serves the UI                                              |
| Navigation                        | Hash route, selected machine, settings section                                               | URL; Next routing when migrated                                                                      |
| Unsubmitted form values           | Home execution/tools, project/preset/note editors, gateway, skill and MCP dialogs, Git draft | Component state, with a local reducer where transitions are coupled                                  |
| Durable unsent text               | Home/task prompts and scheduled time                                                         | Existing browser storage adapter, scoped as today                                                    |
| Local interaction state           | Expanded rows, search input, open menus/dialogs, dragged item, copied feedback               | Local React state; refs for DOM handles and transient imperative data                                |
| Shared shell controls             | Sidebar visibility and global commands                                                       | Local shell reducer first; small Zustand store only if independently subscribed consumers justify it |
| Derived values                    | Filtered lists, selected project, running status, permissions                                | Derive from the authoritative state; do not store a second copy                                      |
| External imperative resources     | File-tree model, syntax worker, DOM focus, timers                                            | Keep lifecycle effects and refs                                                                      |

The many `useState` declarations are not themselves a defect. Most editor fields are intentional drafts that should survive background revalidation without being overwritten. Extracting server state will make the remaining UI state easier to reason about. For complex local workflows such as the Git panel, a typed operation/overlay state and `useReducer` may express transitions more clearly than several coordinated booleans. Do not introduce a general state-machine or form library solely to reduce hook counts.

The storage adapter already supplies same-tab and cross-tab updates and a server snapshot. Preserve the intentional exception that carries the new-home prompt between machines. Version structured persisted values if their schemas change. If typing profiles show synchronous storage writes are expensive, separate immediate input state from debounced persistence with a reliable flush; do not add that complexity without evidence.

## Library and framework decision

| Option                                   | Fit for Nerilo                                                                                                          | Decision                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TanStack Query                           | Shared server-data cache, resource invalidation, cancellation, selectors, mutation lifecycle, resource-specific polling | Best fit for the main problem                                               |
| SWR                                      | Shared fetching, revalidation, subscriptions and optimistic mutations; also fits the Vercel skill                       | Credible alternative; choose one query library, not both                    |
| Zustand                                  | Shared client state with selective subscriptions                                                                        | Optional for shell UI; not a replacement for the query layer                |
| React state/context/reducers             | Local drafts, small shared values, coordinated local transitions                                                        | Keep and use deliberately                                                   |
| Next Server Components and React `use()` | Initial server-known data and rendering boundaries                                                                      | Useful selectively; do not replace ongoing browser synchronization          |
| Next Server Actions and cache tags       | Server mutations and invalidation of cached server reads                                                                | Not an immediate simplification for the existing authenticated daemon proxy |

TanStack Query is designed for [server-state synchronization](https://tanstack.com/query/latest/docs/framework/react/overview). Its [structural sharing and selectors](https://tanstack.com/query/latest/docs/framework/react/guides/render-optimizations) fit the broad snapshot subscriptions. [Cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation) requires consuming the supplied signal. SWR also supports [optimistic writes and mutation/read race handling](https://swr.vercel.app/docs/mutation); the recommendation is based on Nerilo's mix of resource queries and command workflows, not a claim that SWR cannot handle them.

The installed [Next client-fetching guide](../../apps/web/node_modules/next/dist/docs/01-app/02-guides/client-side-data-fetching/index.md) explicitly separates server initial data, browser query caches, and Next's own caches. Nerilo currently uses Next chiefly for its shell and authenticated Route Handler proxy. Adding `use cache`, `revalidatePath`, or Server Actions would not invalidate these existing hook states automatically. It would introduce another ownership layer unless the data flow were deliberately redesigned. Server Components cannot see the current hash route; task-specific initial rendering first needs server-visible routing.

Zustand would be my choice if a shared UI store becomes useful, consistent with the repository preferences. Its [Next integration guidance](https://zustand.docs.pmnd.rs/learn/guides/nextjs) calls for request isolation and matching hydration state. Keep daemon entities out of that store so they are not duplicated between two caches.

## Concrete migration shape

1. Fix partial settings writes and add regression coverage for a successful mutation followed by failed revalidation. Establish what counts as write success independently of refresh success.
2. Add a shared query provider and resource query options. Keep Zod validation and the existing API error messages/idempotency behavior. Remove root data loading and `useApiQuery` as their callers migrate.
3. Migrate snapshot, selected task, and machine registry first. Then models, PRs, Autopilot, files, folders, summaries, and eligible Git reads. Keep form values local and command execution explicit.
4. Replace refresh props with domain mutation hooks and explicit invalidation. Keep one owner for each optimistic value; do not layer React optimistic state and cache optimism over the same reorder operation.
5. Move live-event handling to a dedicated bridge into the cache. Preserve current polling coverage until the daemon can signal every relevant change.
6. Adopt URL-owned navigation, then simplify remaining shell and dialog transitions. Reassess Zustand at this point instead of installing it by default.

Suggested query identities:

```text
["machine", machineId, "snapshot"]
["machine", machineId, "tasks", taskId, "detail"]
["machine", machineId, "models"]
["machine", machineId, "projects", projectId, "pull-requests"]
["machine", machineId, "tasks", taskId, "autonomy"]
["machine", machineId, "tasks", taskId, "files", revision]
["machine", machineId, "tasks", taskId, "file", revision, filePath]
["machine-registry"]
```

Machine identity must be explicit in both the key and request function. Today `apiUrl()` reads the selected machine from global location at call time; carrying that design into a persistent cache could let a key and request target disagree during future client-side machine switching. Include additional inputs when they change resource identity. Use invalidation for revisions of a mutable resource instead of adding a new cache entry for every polling tick. The machine registry belongs to the local web host, so it is a distinct scope.

Set query freshness, retention, and retry policies deliberately rather than accepting every default. [TanStack's defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults) include stale initial query data, refetch triggers, retries, and retention. Keep useful cached data visible during background failures. Expose HTTP status in typed API errors so authentication/validation failures and temporary daemon outages can have different recovery behavior. Do not use `staleTime: 'static'` for mutable daemon data.

Nerilo must remain usable against a local daemon when external connectivity is unavailable. Consider `networkMode: 'always'` for localhost proxy requests so browser connectivity state does not pause reachable local resources. This is an application-specific choice based on [TanStack's network modes](https://tanstack.com/query/latest/docs/framework/react/guides/network-mode), and needs an offline-local regression check. Do not persist or replay command mutations automatically.

Server-rendered query clients must remain isolated per request; the browser client should survive normal renders. Keep the current full navigation on machine changes until all query identities, drafts, subscriptions, and cancellation paths safely support client-side switching.

## Acceptance checks for implementation

- A successful settings change survives a failed refresh and a subsequent unrelated change.
- A slow task A request does not delay task B navigation or replace B's data.
- Concurrent consumers of the same resource share a request; returning to a task can show cached data while it refreshes.
- Polls and live events converge after reconnect without starting unbounded overlapping reads.
- A slow Autopilot read cannot overwrite a newer save response.
- Identical task IDs on different machines never share cached data or drafts unintentionally.
- A lost submission response preserves the original idempotency key; there is no automatic duplicate agent run or Git command.
- Settings navigation updates the URL and restores correctly on reload and browser back/forward.
- Editor drafts and keyboard focus survive background updates and optimistic rollback.
- Local daemon reads remain available without external connectivity; unavailable remote resources report their own failures.

No application tests or builds were rerun solely for this review because application code was not changed. The manual browser reproduction used the previously verified production build. The review document was formatting-checked.
