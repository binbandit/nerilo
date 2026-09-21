# Repository structure

Nerilo is a Bun workspace. Applications own their runtime code; packages expose shared contracts and the design theme. Run development and validation commands from the repository root.

```text
apps/
  daemon/src/
    index.ts             Daemon entry point
    agents/              Provider login, credentials, gateways, models, suggestions
    git/                 Revisions, working changes, history, pull requests
    http/                API handlers and API integration tests
    platform/            Configuration, private files, machine identity, storage
    projects/            Project lifecycle and remote project discovery
    sandbox/             Container limits and provider networking
    tasks/               Execution, scheduling, autonomy, verification, task state, workspace files
    tools/               Agent tools, skills, skill sources, MCP
  web/src/
    app/                 Next.js routes, root layout, page composition
    components/
      composer/          Shared message composer and agent/model pickers
      editors/           Shared record editors and dialogs
      ui/                UI primitives, copy control, provider icon, picker styles
    features/
      home/              Home screen, task creation, setup checklist
      machines/          Machine selection, connection UI, browser machine state
      navigation/        Sidebar, keyboard navigation, shortcut preferences
      projects/          Project lists, actions, names, project pull requests
      review/            Diffs, file browser, syntax worker, Git and PR controls
      settings/          Connections, provider login, keyboard, MCP, sandbox settings
      skills/            Skill settings, discovery, imports
      tasks/             Task view, activity, timeline, queue, autonomy
    lib/                 Shared API client, refresh, focus, forms, draft storage
    server/              Machine registry and proxy integration tests
    styles/              Global styles and workspace layout
packages/
  protocol/src/          Shared schemas, types, and protocol utilities
  theme/
    src/                 Editable Astryx theme source
    dist/                Committed generated theme exports
    preview/             Isolated theme component preview
containers/
  Dockerfile             Agent image definition
  src/                   Container runtime modules and colocated tests
scripts/
  dev.ts                 Local development launcher
  machine-connection.ts  Machine connection-file export
  smoke/                 Docker, sandbox, verification, network, gateway checks
  testing/setup.ts       Disposable test data and isolated Git configuration
docs/
  architecture/          Implementation and runtime design
  assets/                Moodboard and documentation images
  design/                Product and visual direction
  guides/                Feature and setup guides
  reviews/               Dated reviews and validation evidence
```

## Placement rules

- Put feature-specific UI, helpers, tests, and styles together in its feature folder. Use shared `components/` and `lib/` only for code used across features.
- Keep Next.js route files in `app/`. Put server-side persistence in `server/` and browser state with its feature.
- Import web modules directly with `@/` paths. Keep the syntax worker's `new URL(..., import.meta.url)` reference relative so the bundler can discover it.
- Keep daemon modules with the responsibility they implement. Tests stay beside the code under test; API integration tests belong in `http/`. The API entry point owns authentication, request parsing, and error responses; route modules own reads, records, settings, connections, and task operations. Keep task availability and locking checks in `task-routes.ts` before dispatching mutations.
- Use distinct names for a component and its data helpers, such as `diff-review.tsx` / `diff-parser.ts` and `task-timeline.tsx` / `timeline-model.ts`.
- `task-view.tsx` coordinates task actions and navigation. Conversation, Markdown, changes, and task details have separate components in the same feature folder; keep their presentation there rather than growing the page component.
- Add shared contracts to `packages/protocol`; preserve its public package exports. Small shared packages do not need another layer of folders.
- Use the root `bun.lock` for the workspace. Generated caches and dependencies are ignored; the theme's generated `dist/` files are intentionally committed and rebuilt through its CLI.
- Keep historical reviews in `docs/reviews/` and current instructions in `docs/guides/`. Link new documentation from the [documentation index](README.md).

## Validation and runtime paths

`bun run test` discovers tests across daemon, web, and container source and preloads `scripts/testing/setup.ts`. This keeps credentials and fixture repositories away from everyday data. `bun run typecheck`, `bun run format:check`, `bun run --cwd packages/theme check`, and `bun run build` cover the remaining standard checks.

The container build context remains `containers/`. Its Dockerfile copies `src/*.mjs` to `/opt/nerilo/`; `.dockerignore` excludes the test modules from the image. Runtime entry points inside the image keep their existing paths.

Smoke checks live in `scripts/smoke/`. `docker-smoke.ts`, `sandbox-smoke.ts`, and `verification-smoke.ts` use disposable fixtures. `network-smoke.ts` reaches provider endpoints, `gateway-smoke.ts` uses a local fixture gateway, and `network-agent-smoke.ts` performs a real provider request using an existing connection. Run the live provider check deliberately.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the complete development workflow.
