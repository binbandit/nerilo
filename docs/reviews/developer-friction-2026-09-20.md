# Developer friction from the workplace simulation

Observed on 20 September 2026 while operating Nerilo through its browser UI with three real GitHub accounts. These are findings from the [first workplace simulation](workplace-simulation-2026-09-20.md), not a claim that every developer workflow has been tested. The detailed observations below preserve the original reproduction. The status table and [round-two acceptance report](workplace-simulation-round-2-2026-09-20.md) track subsequent repairs to these bugs and friction points.

## Confirmed bugs

| ID     | Priority | Finding                                                                                                | Status                                                                                                  |
| ------ | -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| SIM-01 | P1       | GitHub-only project commits fail when Git identity lives in an included configuration file.            | Fixed and retested through the UI.                                                                      |
| SIM-02 | P1       | Enabling Autopilot after manual publication creates a second PR and leaves the original review behind. | Existing-PR adoption implemented and verified in round two without creating a duplicate.                |
| SIM-03 | P2       | Saved task summaries contradict later publication and Autopilot state.                                 | Fixed and retested through the UI.                                                                      |
| SIM-04 | P1       | A fresh PR import includes an old base revision, omitting changes teammates already merged.            | Fixed; a new browser-created import included the current base and the agent integrated it successfully. |
| SIM-05 | P1       | Manual publication loses a base merge performed inside the agent workspace.                            | Fixed. Round two published the exact two-parent merge; GitHub CI passed and PR #4 merged.               |

P1 means a core collaboration workflow fails or publishes an unintended result. P2 means misleading state or recurring friction. These priorities apply to this simulation's scope.

### SIM-05: conflict repaired in the workspace, still conflicting after publication

**Developer experience:** The agent says it merged the current base and all 17 tests pass. The user reviews the files, commits, and pushes with Nerilo. Nerilo confirms the push and says the branch is up to date with GitHub. The PR still cannot merge.

**Reproduction:**

1. Start **Work on PR** for [PR #4](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/4), whose priority feature conflicts with changes merged through #3 and #6.
2. Ask the agent to fix the requested priority normalization and merge the bundled current base, preserving both sides.
3. Confirm the agent's merge and 17 passing tests. Review the result, which includes the newer title and deadline behavior.
4. Open **Changes**, create a local branch with the original PR branch name, commit, and push.
5. GitHub still reports `CONFLICTING`; there are no new PR checks on that published revision.

**Evidence:**

- [Retained task](http://127.0.0.1:5285/#task/8f32382b-2b04-4889-b561-f68a8b081645).
- Imported target base: `50ee43b0f1bf3c53fc39a05410d1aa049622a4a3`.
- Resulting agent-workspace head: `bdbe9ac5aedce70dc35ea2c8a978347fc54e4b9c`.
- Published head: `f9f4438dcf00dd89e8f770ad9f9d6dfa00852204`.
- The published commit has only `98c21a22c92fa97fbaa593189e5df8f3cd08c30c` as parent; the current base is not its ancestor.
- Read-only Git graph inspection, GitHub status, and the task result are retained under `/Users/brayden/.nerilo-simulations/20260920-workplace`, including `manual-conflict-publication.json` and `github-pr-evidence.json`.

**Cause in the first-round code:** `Engine.checkout` reconstructed the result as a patch on `latest.result.baseCommit`. The subsequent Git action created a single-parent commit. The agent's merge ancestry was not carried into the publishable checkout.

**Required outcome:** Preserve a reviewed base integration through export and publication, while maintaining branch ownership and stale-checkout protections. The regression must assert that the target base is an ancestor of the actual published head, both sides' behavior survives, GitHub clears the conflict, and CI runs on that head. Passing file tests alone is insufficient. Do not resolve this by blindly accepting either side or forcing over another contributor's push.

**Round-two disposition:** The original failed task remains as evidence. A new conflict-repair workspace published exact merge `df3c4428fc57f3bb9298c22a0085908c5c85110d`, preserving both the PR and current target as parents. All 17 tests and GitHub CI passed, the reviewer approved, and PR #4 merged. See the round-two report for the additional Docker export defect found and repaired during this retry.

## Workflows that took more effort than they should

### F-01: taking over an existing PR requires choosing the workflow in advance

**Observed:** A developer can manually publish a useful task and only later decide to let Autopilot address review feedback. That transition originally duplicated the PR. The repair now explains that taking over an existing PR is unsupported.

**Impact:** Developers must anticipate their preferred level of automation before publishing, or manage every subsequent publication manually.

**Suggested improvement:** Support explicit adoption of the existing PR with its branch, head, review history, and ownership checks. Until that exists, explain this restriction before enabling Autopilot on a published task. Keep the duplicate-prevention guard.

### F-02: publishing an imported PR repair requires re-entering its branch name

**Observed:** **Changes** creates a `nerilo/<task-id>` checkout. To update the original PR, I had to open **Create a branch**, replace its suggestion with `codex/priority-queue`, then commit and push. The imported title and failing-CI fixes required the same kind of branch selection.

**Impact:** The user already selected a PR, but must understand and re-enter its branch information. Accepting the default can lead toward publishing unrelated work instead of updating that PR.

**Suggested improvement:** Offer an explicit **Update this PR** path using the imported head branch, with protection against competing pushes. Make creation of a separate branch an intentional choice.

### F-03: review and conflict work needs manual context assembly

**Observed:** **Work on PR** defaults to the Reviewer preset and a review-only prompt. To implement a requested change, I selected Programmer and replaced that prompt with the reviewer comments, conflict context, and preservation requirements.

**Impact:** The relevant feedback already appears in Nerilo, but the developer has to restate it correctly. It is easy to omit an inline thread, the affected revision, or a base-change requirement.

**Suggested improvement:** Distinguish reviewing a PR from addressing its feedback or resolving its conflicts. Carry the relevant feedback and exact revisions into the chosen action, with the instructions visible before starting.

### F-04: re-importing to refresh context creates indistinguishable tasks

**Observed:** Re-running **Work on PR** for #4 created multiple tasks titled `#4 · feat: prioritize open support tickets`. They appear next to each other and truncate identically in the sidebar. Existing task revisions remain pinned, so testing the base-import fix required a fresh task.

**Impact:** Developers must open tasks to work out which contains the old reproduction, the current repair, or the publishable checkout. Conversation continuity is also harder to follow.

**Suggested improvement:** Offer an explicit refresh or continuation flow with a visible revision boundary. If a separate task is required, distinguish its purpose and starting revision and link it to the earlier task. Do not silently overwrite the existing workspace.

### F-05: successful publication looks more complete than the PR really is

**Observed:** After the unresolved conflict repair, **Changes** displayed **Branch pushed** and **Up to date with GitHub**, while the PR badge still reported conflicts and requested changes. The positive publication state is more prominent than the remaining merge problem.

**Impact:** “Up to date” is easy to read as ready for review or merge, even though it only means the local branch matches its remote branch.

**Suggested improvement:** Make branch synchronization and PR readiness clear in the same panel. Show the current conflict or failed requirement alongside the successful push. Preserve the accurate distinction between local verification and GitHub checks.

### F-06: different diff comparisons are not obvious

**Observed:** The successful base integration showed **Review 6 files**, including changes from teammates. After committing, **Changes** showed **Committed changes 3 files**, representing the remaining feature difference against the imported base.

**Impact:** The file counts appear inconsistent unless the developer already understands both comparison baselines. That is especially confusing during conflict recovery.

**Suggested improvement:** Label what each view compares, such as the latest agent turn versus the PR's changes relative to its target branch. Keep the relevant revision available without requiring Git knowledge to interpret the screen.

### F-07: GitHub policy limitations are discovered late

**Observed:** Automatic publication succeeded for #7 and #8, then Autopilot stopped with **Could not read all active branch requirements**. A separate GitHub protection request explained that the private repository requires a paid plan or public visibility for the feature.

**Impact:** The developer sees an opaque permission/policy failure after the agent has already done the work and published it. The message does not explain which capability is unavailable or what would unblock it.

**Suggested improvement:** Check required repository capabilities when configuring Autopilot and show a concrete reason and available choices. Investigate whether **Open PR and address feedback** can safely handle feedback without merge-policy access; do not assume absent policy means merging is allowed.

**Classification:** The plan restriction is external. The timing and clarity of the product's explanation are developer friction. The safety stop itself is correct while merge policy is unknown.

### F-08: multi-account defaults leave the acting identity implicit

**Observed:** The import dialog says **Use project default (machine default)** until an account is selected. Explicit `@binbandit` and `@sage-smudge` choices worked, and GitHub confirmed the selected PR author without switching the machine's active CLI account.

**Impact:** A developer using several accounts has to open the picker or remember the account hierarchy to know who will publish.

**Suggested improvement:** Show the resolved login beside inherited/default choices and on the final publication action. Preserve the successful per-task isolation tested here.

### F-09: historical responses can read like current publication status

**Observed:** An agent response says “Nothing pushed or published,” followed by timeline events showing that Autopilot published its result. The saved state-summary bug was fixed, but the historical response correctly remains unchanged.

**Impact:** A developer skimming the last response can take an accurate historical statement as the current state.

**Suggested improvement:** Clearly separate the agent's end-of-turn report from the current task/PR state, and keep the latest publication status visible near that report. Do not rewrite historical responses.

### F-10: merged PRs still need a manual task-completion step

**Observed:** Imported #3 and #6 displayed a merged PR while the task remained **Ready**. I manually completed #3, then archived and restored it successfully.

**Impact:** Developers have one more cleanup step and can accumulate apparently unfinished tasks whose PRs already merged.

**Suggested improvement:** Offer a clear completion action when a linked PR merges, or an explicit preference for automatic completion. Do not silently complete a task that still owns unrelated work. This is a workflow choice, not a demonstrated data-loss bug.

## Testing and development setup friction

The shared working tree was being changed by another task during this run. Development reloads and a temporary missing icon import interrupted the browser session, so the simulation switched to a separate production build. That stabilized testing. This is recorded as a test-environment issue, not attributed to normal production use of Nerilo. Keep isolated test data, ports, and a fixed build for repeatable acceptance runs.

## Follow-through

- Resolve SIM-05 and repeat the entire conflict-repair/publication flow through the UI.
- Repeat the protected-review, freshness, and exact-head merge cases once the repository supports those policies. The visibility question is still pending; the repository remains private.
- Retest each proposed friction improvement against its observed scenario instead of treating this document as evidence that it has been implemented.
- The four repaired bugs and the remaining open workflow are detailed in the [simulation report](workplace-simulation-2026-09-20.md). Current validation is 281 passing tests, with lint, types, formatting, production build, theme consistency, and real Docker smoke checks passing for the tested changes.
