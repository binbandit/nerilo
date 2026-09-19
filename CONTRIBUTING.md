# Developing Nerilo

Use Bun 1.4.2, Git, and Docker. See [the README](README.md#run-locally) for local setup. The repository is a Bun workspace: the daemon is in `apps/daemon`, the Next.js app is in `apps/web`, shared contracts are in `packages/protocol`, and the Astryx theme is in `packages/theme`.

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
bun run typecheck
bun run test
bun run --cwd packages/theme check
bun run build
```

Use `bun run format` to fix formatting. Type checking generates Next.js route declarations first, so it works on a fresh clone. `next-env.d.ts`, build output, dependencies, and local environment files are ignored. Theme output in `packages/theme/dist` is committed; rebuild it after changing the theme source.

For container or task lifecycle changes, also run:

```sh
bun run image:build
bun run test:docker
bun scripts/verification-smoke.ts
bun scripts/sandbox-smoke.ts
```

The standard suite uses temporary data and isolated Git configuration. Docker smoke checks use deterministic fixtures without model credentials or paid model calls. Live provider and network smoke scripts are separate, manual checks.

For a second local instance, set `NERILO_DATA_DIR`, `NERILO_WEB_PORT`, `NERILO_DAEMON_PORT`, and `NERILO_NEXT_DIST_DIR` to separate values. Keep verification work away from your everyday instance and credentials.

## GitHub checks

CI runs on pull requests, pushes to `main`, and manual dispatch. It checks formatting, types, generated theme consistency, and the production build; runs tests on Linux and macOS; and builds and exercises the Docker runtime on Linux. PR titles must use the conventional format. Jobs use read-only repository access and pinned action revisions. Dependabot proposes weekly GitHub Actions updates.

Keep the lockfile with dependency changes and use `bun install --frozen-lockfile` in validation. This repository does not publish packages or deploy an application automatically.
