# Developing Nerilo

Use Bun 1.4.2, Git, and Docker. See [the README](README.md#run-locally) for local setup. The repository is a Bun workspace: the daemon is in `apps/daemon`, the Next.js app is in `apps/web`, shared contracts are in `packages/protocol`, and the Astryx theme is in `packages/theme`.

## File organization

Follow the [repository structure](docs/repository-structure.md). Keep feature code, styles, and tests together; reserve shared folders for code used by multiple features. Add guides, design notes, and review records to their respective documentation folders and update the [documentation index](docs/README.md).

## Code conventions

- Keep modules focused on one responsibility and name them after the work they own. Extract a component or helper when it gives a substantial section a clear name or removes repeated logic.
- Prefer inferred types and validate external data at the boundary. Use type-only imports for dependencies that are needed only by TypeScript.
- Define React components at module scope so updates preserve their identity and state. Derive values from props when possible; use effects for external synchronization and clean up subscriptions and pending work.
- Keep expensive conversation rendering separate from composer state. Memoize measured or clearly repeated work, and keep callbacks stable when a memoized child depends on them.
- Use the shared query options for daemon reads and `useApiMutation` for writes. Keep routes in the URL and editable drafts local. Follow [React state ownership](docs/architecture/react-state.md) when adding resource keys, cache updates, or polling.
- Preserve accessible names, keyboard behavior, and error recovery when refactoring. Comments should explain constraints or intent that the code cannot make clear itself.

## Branches and commits

Start each change from an up-to-date `main` and use a short-lived branch:

```sh
git switch main
git pull --ff-only
git switch -c feat/task-search
```

Keep commits focused on one purpose and include the relevant tests and documentation. Use conventional commit messages and PR titles, such as `feat(web): add task search`, `fix(daemon): retain queued follow-ups`, or `docs: clarify local setup`. Use `!` for a breaking change and explain it in the body.

Push your branch and open a pull request against `main`. Describe the behavior change, validation, and any migration or compatibility concerns. Squash merge after the checks pass and review is complete. The PR title becomes the squash commit title. Merged branches are deleted automatically on GitHub.

## Checks

From the repository root:

```sh
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run --cwd packages/theme check
bun run build
```

Use `bun run check` for formatting, React lint, types, tests, and theme validation together. Use `bun run format` to fix formatting across source, configuration, documentation, and the theme preview. The root Prettier and EditorConfig files define the shared style; `.prettierignore` keeps generated files and local data out of formatting.

`bun run lint` applies the recommended React Hooks rules to all web and theme preview source, including effect dependencies, render purity, component identity, and state updates in effects. Keep interaction logic in handlers and derive values without mirroring props into state. Use `useSyncExternalStore` for browser storage and cancel obsolete data requests.

The native TypeScript 7 compiler is installed as `@typescript/native` and still runs through `tsc`. The `typescript` alias supplies Microsoft's TypeScript 6 compatibility API for the ESLint parser, which does not yet support the native compiler API.

Type checking generates Next.js route declarations first, so it works on a fresh clone. `next-env.d.ts`, build output, dependencies, and local environment files are ignored. Theme output in `packages/theme/dist` is committed; rebuild it after changing the theme source.

For container or task lifecycle changes, also run:

```sh
bun run image:build
bun run test:docker
bun scripts/smoke/verification-smoke.ts
bun scripts/smoke/sandbox-smoke.ts
```

The standard suite uses temporary data and isolated Git configuration. Docker smoke checks use deterministic fixtures without model credentials or paid model calls. Live provider and network smoke scripts are separate, manual checks.

For a second local instance, set `NERILO_DATA_DIR`, `NERILO_WEB_PORT`, `NERILO_DAEMON_PORT`, and `NERILO_NEXT_DIST_DIR` to separate values. Keep verification work away from your everyday instance and credentials.

## GitHub checks

CI runs on pull requests, pushes to `main`, and manual dispatch. It checks formatting, React hooks, types, generated theme consistency, and the production build; runs tests on Linux and macOS; and builds and exercises the Docker runtime on Linux. PR titles must use the conventional format. Jobs use read-only repository access and pinned action revisions. Dependabot proposes weekly GitHub Actions updates.

Keep the lockfile with dependency changes and use `bun install --frozen-lockfile` in validation. This repository does not publish packages or deploy an application automatically.
