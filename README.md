# Nerilo

A local AI agent workspace. Room to make.

Next.js and Astryx on the front end, a Bun daemon with SQLite, and a separate Docker workspace for each task. Connect an existing Codex or Claude Code login, or an API key, give a task direction, review its changes, and continue the same agent session.

## Run locally

Requires Bun 1.4.2, Git, and Docker Desktop. Start Docker Desktop, then:

```sh
bun install --frozen-lockfile
bun run image:build
bun run dev
```

Open [Nerilo](http://127.0.0.1:5185). In Settings, choose **Use existing Codex login** or **Use existing Claude Code login**, or add an agent API key. Claude Code can also sign in through its own browser flow. Add a GitHub repository or a local Git repository with at least one commit. Project settings accept optional preparation and verification commands that run inside the container.

The web app listens on `127.0.0.1:5185`; the daemon listens on `127.0.0.1:5186`. To run them separately, use `bun run daemon` and `bun run web`. Closing the browser leaves the daemon working. Stopping `bun run dev` stops both local processes; running containers and saved work remain, and the next daemon start reconciles their results.

## Multiple machines

Add another daemon in **Settings → Machines**, or use **Manage machines** in the sidebar machine menu. Import its connection file or enter its HTTPS or SSH tunnel address and connection token. Select the machine from the sidebar or new-task composer before starting work.

Each machine owns its projects, agent connections, settings, and tasks. Task links remember the selected machine; follow-ups, Git actions, files, and queued work stay there. A disconnected machine never falls back to another one. Renaming, reconnecting, or removing a registration does not delete its work. See [machine setup](docs/machines.md) for installation, SSH, HTTPS, and connection-file export.

## Working with tasks

- Start from a committed repository or include local changes. Opt into new, untracked files from Workspace options; Git-ignored files stay excluded. Local changes become an isolated starting snapshot, so the diff shows the agent’s changes separately.
- Send follow-ups while a task runs, pause it, or resume its retained session and workspace. Change provider, model, and effort from the composer at any time; a running turn keeps its original settings. Switching providers carries conversation context into a new session in the same workspace.
- Review the resulting diff, inspect changed text or image files, and export a patch. Applying a patch requires a clean host checkout at the task's starting commit. Application writes local files without committing or pushing.
- Add line comments through **Review files** below an agent response. Draft feedback survives refreshes, stays attached to the reviewed turn, and sends as one follow-up with file, line, and revision context. Earlier turns remain reviewable; feedback queues while the agent works. See [code review](docs/code-review.md).
- Choose **Browse files** in task actions, or **Browse all files** in Task details, to explore the retained repository with Pierre Trees. Expand folders, search paths, filter changed files, and navigate with your saved keyboard shortcuts. The virtualized tree includes file icons and Git status markers. Preview code/text or PNG/JPEG images and copy contents or paths. **Add file to follow-up** inserts a reference into your draft. Browsing works after the agent container stops and reads the sandbox, not an exported checkout.
- Choose **Export project** on a reviewed turn to run or edit its code on your Mac. Each checkout is a separate folder and branch; existing folders and your project are never overwritten. Install dependencies there before running it. Tasks started with local changes use this path for local review.
- Agent completion and project checks are separate outcomes. A failed check retains its output and attention indicator without marking a successful agent turn as failed. Follow-ups can continue the work.
- Browse open GitHub PRs from a project’s sidebar menu. Start a task at a PR’s pinned revision with its comparison base, or link it to an existing task.
- Link GitHub PRs from a task’s menu. Review and CI signals appear beside the task; open them for details, refresh, or unlink. The local GitHub CLI login supplies access. A compact PR chip in the task header opens the same details.
- Edit agent presets and project reference notes, archive tasks, and choose light, dark, or system appearance.
- Right-click a task to archive or delete it.
- Queue follow-ups while an agent works, edit or remove queued messages, and drag to reorder them. Schedule a follow-up for a later local time. Scheduled messages persist in the daemon and run when due while the device is awake.
- Choose a GitHub repository directly when creating a project. A local working copy is optional.
- Set sandbox defaults or override a task’s workspace access, network access, CPU, memory, and process limits for its next turn.
- Drag project names or task rows to reorder the sidebar. Tasks stay within their project. Alt + Up/Down reorders the focused item by keyboard. Order is saved by the daemon and shared across browser tabs; new items appear after manually ordered items.

Data is stored in `~/.nerilo` (override with `NERILO_DATA_DIR`). On macOS, API keys use Keychain. Importing an existing login creates a private local copy without writing to the original CLI's credential storage. Claude Code's copy lives in a dedicated Docker auth volume; the official CLI manages refreshes there. Container refreshes are not synchronized back to the host. Use **Refresh login** in Settings if an imported login expires or is revoked. Disconnecting an imported login removes only Nerilo's copy, without signing out the host CLI. Finish running Claude tasks before importing or disconnecting their login. The separate verification container receives no agent credentials. Treat project commands and agent work as trusted code with outbound network access.

AI task names preserve manual titles. Collapsed requests can show a short AI summary while their complete text remains available when expanded. A quiet sentence above the conversation summarizes current activity or the final outcome; it updates during active work and on completion. Existing completed history is not automatically backfilled, and unavailable inference leaves these optional summaries absent.

Code blocks, file previews, diffs, and commands use `gpu-lexer` for syntax highlighting when WebGPU is available. Highlighting loads on demand and preserves the original text. Unsupported browsers, failures, and oversized text fall back to plain text; no alternate CPU lexer is used.

Containers run as a non-root user with a read-only root filesystem, dropped capabilities, CPU/memory limits, and dedicated workspace/home volumes. They receive neither host directory mounts nor the Docker socket. These controls limit access; they do not make Docker a complete sandbox for hostile code.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the branch and PR workflow, conventional commits, and required checks. GitHub Actions runs the test suite on Linux and macOS, checks formatting and types, builds the web app, and verifies the Docker runtime.

React Grab loads during local development (`bun run dev` or `bun run web`). Hover over a UI element, press ⌘C or Ctrl+C, and paste its source context into your coding agent. The script is excluded from production builds.

```sh
bun run typecheck
bun run test
bun run test:docker
bun run format:check
bun run build
```

Tests use disposable data directories and isolated Git configuration. Set `NERILO_WEB_PORT` and `NERILO_DAEMON_PORT` to run a separate local instance, and `NERILO_NEXT_DIST_DIR` to keep its Next build output separate. The defaults remain 5185, 5186, and `.next`.

See the [19 September code review and repairs](docs/review-2026-09-19.md) for findings, fixes, regression coverage, and validation boundaries.

The Docker smoke test uses temporary repositories and a deterministic fixture runner, makes no model calls, and cleans up its own containers and volumes. Real Codex creation and session resumption have also been exercised with a local login. Existing Claude Code login import, official container CLI authentication, a small live response, and structured AI summary generation have been verified. A live Claude editing task and follow-up also passed independent verification and retained the same native session. See [the live lifecycle demonstration](docs/lifecycle-demo.md) for GitHub and Claude evidence.

This is a working local first version. Opt-in Autopilot can publish a task, address PR feedback and failed CI, update its branch, and squash-merge when GitHub requirements pass. A packaged installer, automatic startup, remote execution, automated directors, and multi-agent workflows remain future work. Archive retains resumable files and history; deleting a task removes its owned sandbox resources while keeping exported projects. See [implementation details](docs/implementation.md) for behavior and limits.

## Design

- [Moodboard](nerilo.png)
- [Product and visual direction](docs/nerilo-direction.md)
- [Architecture proposal](docs/architecture-proposal.md)
- [Astryx integration](docs/astryx-integration.md)
- [Nerilo theme](packages/theme/README.md)

Everyday screens assume familiarity with agent tools. A task has one header; each request and result form one group. Activity, file details, and session metadata appear on demand. Explanatory copy is reserved for consequential choices and errors.

The [sidebar and PR direction](docs/sidebar-and-pr-direction.md) records the latest navigation decisions and current GitHub scope.

Task Git actions support local checkout review, branches, commits, explicit pushes, and pull requests. The Changes panel checks the remote branch when opened or refreshed and after Git actions, showing whether it is unpublished, up to date, ahead, behind, or diverged. Connection failures retain an unavailable state, and PR creation is offered only after the reviewed commit is confirmed on GitHub. AI drafts are editable before use. Tasks that include uncommitted source snapshots can be committed locally but cannot be published through Nerilo.
