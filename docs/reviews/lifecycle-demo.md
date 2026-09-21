# Live lifecycle demonstration

Run on 10 September 2026 against the explicitly authorized `binbandit/test-repo` repository. These are real Nerilo tasks, Docker agent runs, Git commits, GitHub comments and GitHub Actions results.

## Isolation

The demonstration uses `nerilo/lifecycle-base-20260910`, created from the existing main revision. Test files live under `nerilo-demo/`; a dedicated workflow targets only PRs against that branch. Existing repository fixtures, old PRs and default `main` were left intact. The demo project was created from the GitHub repository identifier with no local project path; each task pinned its starting revision and cloned its workspace inside Docker.

The control checkout used to introduce reviewer/base changes is separate from the agent workspace. It lives under `~/.nerilo/test-runs/lifecycle-20260910`. That directory contains task IDs and selected evidence; it is not a prerequisite for remote-project creation.

## Review, conflict and base freshness

[PR #12](https://github.com/binbandit/test-repo/pull/12) belongs to [the first Nerilo task](http://127.0.0.1:5185/#task/b7f8ec62-e77a-483f-8dcf-1219af628a9f).

1. The initial task changed a small greeting function, added focused tests, and passed verification. Nerilo committed, pushed and opened the PR.
2. A real [reviewer comment](https://github.com/binbandit/test-repo/pull/12#issuecomment-5618562353) requested trimming whitespace. The daemon queued an agent turn, published its fix and replied with the result. CI passed on the new head.
3. A base change deliberately touched both greeting files and added numeric-input validation. The agent rebased, resolved conflicts in both files, preserved the feature and base validation, and passed all four tests.
4. The workflow included a 90-second test delay. When a newer base arrived during non-strict CI, the observer recorded: “CI is still running. Preserve this head until its checks settle.” It updated the branch after CI settled.
5. The demo base then required the `lifecycle` check, up-to-date branches and resolved conversations, with enforcement for administrators. [PR #13](https://github.com/binbandit/test-repo/pull/13) advanced that protected base while PR #12's rerun was active. Nerilo detected the strict requirement, rebased immediately, preserved the documentation change and reran validation.
6. After Through merge was selected, Nerilo waited for the new head's required CI, rechecked GitHub and squash-merged PR #12 at 12:44 UTC. Five repair/update turns followed the initial turn.

The real exercise exposed and fixed reuse of an existing export branch, nullable GitHub protection fields and delayed GitHub PR-head propagation. Focused regression tests retain those cases.

## CI repair through autonomous merge

[PR #14](https://github.com/binbandit/test-repo/pull/14) belongs to [the autonomous Nerilo task](http://127.0.0.1:5185/#task/a67a14d6-2972-4b01-b3d5-1dfaebacf4c3). Through merge was enabled when the task was created, before its first result.

The initial prompt specified a final null-name fallback and explicitly requested a failing regression first, so the demonstration would contain a real CI failure. It also instructed subsequent feedback turns to implement the feature while retaining the assertions. The first commit added that regression without changing the implementation. Local verification and [GitHub Actions](https://github.com/binbandit/test-repo/actions/runs/34478573516) both failed as intended.

The daemon read the failed run and queued the repair without another user prompt. The agent implemented the null fallback and preserved numeric rejection. A subsequent [reviewer comment](https://github.com/binbandit/test-repo/pull/14#issuecomment-5618933241) requested the same fallback for whitespace-only names. Nerilo picked it up in another turn, keeping CI and publication under the original Through merge authorization.

The [final CI run](https://github.com/binbandit/test-repo/actions/runs/34479004625) passed all six focused tests on head `55ac7c753f839bd620f58a5470f6f0f031b2fc01`. Nerilo then rechecked the required checks and strict branch policy, and squash-merged PR #14 at 12:52:26 UTC as `69e6cb1539cb6af8855a158cc77ecc8f7e0d0122`. The task used two repair turns after the initial regression commit. No follow-up instructions or merge approval were sent to the task after creation; the reviewer comment was an external test stimulus, processed under its original authorization.

## Existing Claude Code login

[The Claude task](http://127.0.0.1:5185/#task/c698d5b8-3913-41e1-b712-ed020db0cec3) used the imported host Claude Code login and the official CLI's `haiku` alias. It created `hello.txt`, passed the independent `test -s hello.txt` check, then resumed the same native session for a follow-up and passed again. The original host login remained authenticated. Both turns retained session `362efd3a-38d6-427f-8f77-d62b30ed4d98`.

## Scope of the evidence

Review feedback here uses actual PR comments from the repository owner. Formal required approvals and unresolved review-thread blocking are covered by observer tests; this run did not manufacture a second reviewer account or bypass approvals. The controlled initial failing regression and base changes are deliberate test stimuli. Feature repairs, publication, feedback responses, freshness decisions and automated merge handling run through Nerilo's production paths.

The demo base and PRs are retained for inspection. The default branch does not contain the demonstration workflow or feature. The local daemon and Docker must be running for future tasks and scheduled follow-ups to advance.
