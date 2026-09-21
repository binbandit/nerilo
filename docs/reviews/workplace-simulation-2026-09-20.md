# Three-account workplace simulation: 20 September 2026

This records the first round of a real GitHub collaboration exercise driven primarily through Nerilo's browser interface using computer use. It is not a release sign-off. The observations and open items below describe that round's stopping point. [Round two](workplace-simulation-round-2-2026-09-20.md) records delegated repairs and subsequent live acceptance, including successful publication and merge of the retained conflict fixture.

The companion [developer friction log](developer-friction-2026-09-20.md) and [UI audit](ui-simulation-2026-09-20.md) record unnecessary effort, duplicate information, confusing states, and proposed improvements, with fixed and open findings distinguished.

## Environment

- Repository: [binbandit/nerilo-workplace-sim-20260920](https://github.com/binbandit/nerilo-workplace-sim-20260920), private, newly created, synthetic sample code only.
- Team: `binbandit` as maintainer, `WastedHippie` as contributor/reviewer, `sage-smudge` as contributor/reviewer.
- Nerilo UI: <http://127.0.0.1:5285>; daemon: port 5286.
- Separate data and evidence: `/Users/brayden/.nerilo-simulations/20260920-workplace`.
- Separate container image: `nerilo-simulation:20260920`, built from the current container sources.
- The normal `~/.nerilo` database, default preview ports, global Git identity, and active GitHub CLI account were left alone. Git commits in the simulation use a noreply identity through an isolated included Git configuration file.
- The application started against the current working tree, which contains substantial pre-existing reorganization and a concurrently developed GitHub-account feature. Testing switched to a separate production build to avoid development reloads. No working-tree reset, commit, or force push was used on Nerilo itself.

## Real collaboration evidence

| PR                                                                      | Author       | Scenario and observed result                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#3](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/3) | WastedHippie | Formal changes-requested review and inline thread from sage-smudge. Imported with **Work on PR**, repaired by a real agent, reviewed and committed in Nerilo, and pushed to the existing branch. Five tests passed on the published revision. Reviewer resolved the discussion and approved; maintainer squash-merged. Nerilo displayed the approval and merged state.                                                                                                                    |
| [#4](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/4) | binbandit    | Feature created and published entirely through Nerilo. A line-review draft survived reload and resumed the task; seven tests initially passed. WastedHippie requested priority normalization. After two base merges, a fresh import reproduced a stale-base bug, then its repaired import integrated both sides and passed 17 local tests. Publishing the repair exposed lost merge ancestry: the current head still conflicts and has no new GitHub checks. Retained as SIM-05 evidence. |
| [#5](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/5) | binbandit    | Unexpected duplicate created by enabling Autopilot after manually publishing #4. Automation was stopped, duplicate closed with an explanation, and a regression guard added. Retained as bug evidence.                                                                                                                                                                                                                                                                                    |
| [#6](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/6) | sage-smudge  | Deliberately failing deadline-boundary test produced real red GitHub Actions. WastedHippie requested changes. Nerilo imported the PR, reproduced the failure, fixed the implementation without weakening existing assertions, and added a future-deadline test. The repair was reviewed, committed, and pushed through Nerilo. All six tests passed in GitHub; reviewer approved and maintainer squash-merged.                                                                            |
| [#7](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/7) | binbandit    | **Open PR and address feedback** selected before task creation. Nerilo published the result automatically. A concurrent title-formatting merge produced a genuine Git conflict; the project PR list displayed it. Autopilot stopped because GitHub would not provide the private repository's branch requirements.                                                                                                                                                                        |
| [#8](https://github.com/binbandit/nerilo-workplace-sim-20260920/pull/8) | sage-smudge  | Selected `@sage-smudge` in the new-task account picker and enabled automatic publication. GitHub independently confirmed sage-smudge authored the PR, while the machine's active CLI account remained WastedHippie. Tests passed. A concurrent runbook change produced another conflict, retained for follow-up testing.                                                                                                                                                                  |

The two backlog issues were filed by different contributors. GitHub CLI/API calls supplied external teammate actions, independent checks, reviews, thread resolution, and maintainer merges. Nerilo's project creation, task creation, source-PR import, agent execution, local verification, diff review, review follow-up, branch creation, commit, push, PR creation, and account selection were exercised through computer use. No direct database writes were used to manufacture application outcomes.

## Bugs reproduced and repaired

### Included Git identity blocked commits

**Observed:** Clicking **Commit changes** on a GitHub-only project failed with `git failed (1)` even though the user's ordinary Git commands had a configured identity.

**Cause:** Explicit `git config --global` reads do not expand included configuration files by default.

**Fix:** Remote-project identity reads now pass `--includes`. The regression uses a real isolated Git repository and an identity in an included global configuration file, checking both author and committer. It failed before the fix. After restarting the simulation daemon, the same UI commit flow succeeded and PR #4 was created.

Files: `apps/daemon/src/git/git-workflows.ts` and its colocated test.

### Autopilot silently duplicated a manually published PR

**Observed:** Enabling Autopilot on the task linked to #4 published #5 on a different branch, leaving the original requested changes behind.

**Fix:** New activation and initial publication reject tasks that already have an open or draft PR with an actionable explanation. Recovery of previously managed publication remains supported. The regression verifies that no checkout, push, or PR creation occurs. A UI retry on the imported #3 task displayed the explanation and created no duplicate.

**First-round product limitation (resolved in round two):** Taking over an existing manually published PR is not implemented. The supported choices are manual follow-up publication through **Changes**, or enabling Autopilot before the new task is published. This guard prevents the harmful behavior; it does not implement adoption.

Files: `apps/daemon/src/tasks/autonomy.ts` and its colocated test.

### Saved state summaries contradicted publication history

**Observed:** A task summary continued to claim that nothing was published after its timeline showed a push/PR; another described Autopilot as blocked after it had been switched off.

**Fix:** Saved summaries record their publication evidence. Reads hide text when repository events, PR state, or Autopilot state have changed. Recent repository actions are also provided to summary generation. A regression verifies invalidation without initiating inference on reads. The restarted browser session no longer displayed the obsolete summaries. Original agent responses remain historical records of what was true at the end of their turn.

Files: `apps/daemon/src/tasks/state-summary.ts` and its colocated test.

### Fresh PR imports omitted already merged base changes

**Observed:** A new **Work on PR** task for #4 could reproduce and fix its requested priority changes, but reported that its bundled `origin/nerilo-base` lacked the title and deadline changes already merged by teammates. Live GitHub responses confirmed the PR's `baseRefOid` was still `c30ecfd`, while `main` had advanced to `50ee43b`.

**Fix:** PR imports now resolve the actual target branch reference before building the pinned workspace. The regression covers an advanced base, a branch name containing a slash, preserving the PR head, and rejecting an unavailable base instead of silently importing an older one. It failed before the fix. A new browser-created import included `50ee43b`; the agent integrated both sides and passed all 17 sample-project tests.

Files: `apps/daemon/src/git/pull-requests.ts` and its colocated test.

The concurrent account-switching task also temporarily introduced a missing Lucide brand-icon import. Its owner was notified and repaired it before testing continued; that change is separate from the four fixes above.

## First-round defect: manual conflict publication

**Follow-up:** Fixed and verified in [round two](workplace-simulation-round-2-2026-09-20.md). The original failed publication below remains the reproduction evidence; PR #4 has since merged successfully.

After the current-base import was fixed, the agent merged the supplied base and repaired the priority bug in #4. Reviewing, committing, and pushing through **Changes** published the resolved files but dropped the merge ancestry. GitHub still reports a conflict at `f9f4438dcf00dd89e8f770ad9f9d6dfa00852204`, and no new PR checks ran on that revision. The 17 passing local tests do not establish a successful publication or merge.

The checkout exporter reconstructs a patch on the task's original base; the commit action then uses one parent. This needs a reviewed integration-preservation path and an end-to-end regression before release. See **SIM-05** in the [developer friction log](developer-friction-2026-09-20.md) for exact revisions and reproduction steps. The conflicting PR is retained as evidence.

## Additional UI checks

- Project creation from a private GitHub repository with `node --test` verification.
- Real agent task and session follow-up, independent verification output, historical turn review, and inline review context.
- PR-list rendering for passing/failing checks, changes requested, approval, conflicts, and linked tasks.
- Branch publication transitions: uncommitted changes, committed changes, unpublished, one commit ahead, and up to date.
- Task and review-draft persistence across browser and daemon restarts.
- Mark complete, archive, and restore on the merged #3 task; history and retained files remain available.
- Explicit task GitHub account selection without changing the machine-wide active CLI account.
- Production-built UI loaded successfully. Existing preview data remains separate.

## Validation

- Baseline before repairs: **256 tests, 1,477 assertions, 0 failures**.
- Current combined suite: **281 tests, 1,601 assertions, 0 failures**, including concurrently added account coverage.
- Focused Git workflow tests: **7 passing, 49 assertions**.
- Focused Autopilot tests: **10 passing, 75 assertions**, including uncertain-push/PR recovery and foreign-head protection.
- Focused summary tests: **10 passing, 36 assertions**.
- Lint, daemon/web type checking, and a separate Next.js production build passed.
- Formatting and theme-output consistency checks passed.
- Real Docker smoke checks passed: isolation, durable restart, idempotent submission, provider handoff with history, immutable turn settings, follow-up, verification, patch export/application, file previews, pause/resume, and dirty-checkout protection.

## Remaining acceptance run

GitHub returned HTTP 403 when asked to protect the private repository: **“Upgrade to GitHub Pro or make this repository public to enable this feature.”** The observer also cannot establish complete branch policy for this repository, and correctly refuses to proceed as though policy were known. Permission to make the synthetic repository public was requested and has not been assumed.

Once the visibility choice or an eligible repository is available:

1. Require the `Tests` check, one independent approval, stale-approval dismissal, resolved conversations, and an up-to-date branch; enforce requirements for administrators too.
2. Resume #7 and #8 and verify conflict repair preserves the merged title/deadline work and the feature changes, then reruns CI on the actual published head.
3. Submit new formal and inline change requests. Confirm one actionable repair per new event and no repeated processing of old feedback.
4. Verify changes requested, unresolved threads, stale approvals, pending/failing required checks, and an updated base each prevent merge.
5. Approve the final revision and enable **Through to merge**. Verify exact-head squash merge and automatic task completion.
6. Exercise a teammate's competing push and a lost publication response against live GitHub; corresponding lower-level regression tests already pass, but these were not completed as live acceptance cases in this pass.

Separately, fix SIM-05 and repeat manual conflict resolution through publication. This defect is independent of GitHub's private-repository plan limitation.

Broader release readiness is also distinct from this GitHub collaboration exercise. Hosted visitor authentication and execution ownership remain the published-site blocker documented in [the beta readiness review](beta-readiness-2026-09-19.md). This pass does not certify hosted multi-user isolation, real remote-machine networking, or every provider configuration.

## Retained task links

- [Priority feature](http://127.0.0.1:5285/#task/931c1ae8-a1e4-481c-873b-7bc22a1aeb68)
- [Imported title repair](http://127.0.0.1:5285/#task/ad76e1c8-58f4-4945-aff3-09952414e34f)
- [Automatic identifier validation](http://127.0.0.1:5285/#task/2084aa36-b7e9-45c5-8f3b-1b9254f5d6da)
- [Failing-CI repair](http://127.0.0.1:5285/#task/16f6528c-7217-4c57-aa58-9fb716568e03)
- [Account-specific runbook contribution](http://127.0.0.1:5285/#task/c29a51fa-6017-48d0-a71d-7ecbe9ba45a3)
- [Stale-base import reproduction](http://127.0.0.1:5285/#task/fc4216c6-d45a-42ca-9b42-8303f51b5946)
- [Fresh-base repair and publication failure](http://127.0.0.1:5285/#task/8f32382b-2b04-4889-b561-f68a8b081645)

The private repository, open conflict fixtures, task history, and isolated evidence are retained for inspection. Blocked Autopilot tasks were switched off through Nerilo, ready to be resumed for the remaining acceptance run. No ongoing monitor was scheduled.
