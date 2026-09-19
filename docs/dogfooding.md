# Developing Nerilo with Nerilo

The local Nerilo project is configured with `bun install --frozen-lockfile` for preparation and `bun run typecheck && bun run test` for verification.

1. Choose **Nerilo** in the home composer.
2. Open the branch menu and choose **Working changes**. Choose **Working changes + new files** when your work includes files not yet tracked by Git. Ignored files, including dependencies and local environment files, are excluded.
3. Give the agent a bounded change with acceptance criteria. The current workspace gets an independent Git snapshot; your checkout and staging area stay untouched.
4. Follow the task, send follow-ups, and inspect its changes. The diff compares against the captured snapshot, not the older host commit. Project verification is displayed independently from agent completion. **Browse files** in task actions opens the retained sandbox repository, including unchanged source and nonignored new files. Preview a file and choose **Add file to follow-up** to reference it in your next instruction.
5. Use **Review files** below a response to comment directly on changed lines. Collect feedback and send it as one follow-up; the agent receives the reviewed file, line, code, and revision. The turn menu keeps earlier reviews accessible, and drafts persist in this browser.
6. Choose **Export project** in the task menu when you want a separate local copy. The result's code is reconstructed into a fresh folder, with a copyable path in the export confirmation. Git actions prepare their working copy automatically. Install dependencies in that folder before running checks or a preview.
7. Review the resulting patch before integrating it into your working project. Direct application is available for tasks starting from a clean committed baseline when the host checkout still matches it. Local-snapshot tasks use export or separate checkouts because the host may contain other ongoing work.

## First completed loop

On 10 September 2026, the task **Make project-folder errors useful** used the existing Codex login with GPT-5.6-Luna, medium effort. It started from Nerilo's uncommitted source, changed project-folder validation, added five tests, and passed the configured checks. The app-created local checkout passed type checking and all 15 tests on macOS. Its two-file patch was reviewed and incorporated into the working app.

## Current boundaries

- Local checkout edits do not sync back to a task. Create a new project/task from that checkout to continue from those edits.
- Checkouts contain source and the reviewed patch, not installed container dependencies or the agent's private home directory.
- The file browser is read-only and lists up to 10,000 regular repository files. Git-ignored untracked files, Git internals, and symlinks are omitted. Previews are limited to 2 MB. Refresh picks up current sandbox changes; an agent completing a turn also refreshes the view. It does not show edits made to an exported local checkout.
- Each checkout creation makes a new folder. Older copies remain intact; there is no automatic cleanup yet.
- The agent container has no Docker socket. Nerilo's Docker integration tests must run on the host. The default self-development check runs TypeScript and Bun tests.
- Use **Changes** in the task header to create a branch, review and commit checkout changes, push, or open a pull request. **Draft with AI** suggests editable branch names and commit/PR text using the connected agent.
- Publishing requires a GitHub origin on the source project and the host GitHub CLI login. Tasks containing an uncommitted source snapshot cannot publish; commit the source first and start a new task to use this workflow. Local branches and commits still work.
- Opt-in Autopilot supports PR maintenance and squash merging. Embedded development previews and automated host integration remain future work.
- The [real lifecycle demonstration](lifecycle-demo.md) records review feedback, failed CI, conflicts, freshness decisions, and autonomous merging in the testing repository.
