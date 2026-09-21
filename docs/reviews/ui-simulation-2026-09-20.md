# UI observations from the workplace simulation

Recorded on 20 September 2026 from actual desktop browser use and visual inspection of the task conversation, long diff review, Changes panel, PR list, PR import, and Autopilot controls. See the [test report](workplace-simulation-2026-09-20.md) and [developer friction log](developer-friction-2026-09-20.md) for reproduction details and fix status.

The main first-round UI issue was information hierarchy: the successful local step was often prominent, while the reason collaboration was still blocked was small, implicit, or elsewhere. The notes below preserve those observations and distinguish wrong information from accurate information that was easy to misread. The changes were subsequently delegated; see the [round-two acceptance report](workplace-simulation-round-2-2026-09-20.md) for their implementation and browser checks.

## Findings to act on

### UI-01: “Ready” looks too positive for a PR that cannot proceed

**Where:** [PR #4 repair task](http://127.0.0.1:5285/#task/8f32382b-2b04-4889-b561-f68a8b081645), header and sidebar.

**Observed:** The header says **Ready**, with the requested-changes and conflict states represented by small icons in the PR badge. Sidebar rows also have a check-like task icon alongside warning/review icons.

**Why it feels wrong:** A developer must reconcile several compact signals to discover that “Ready” means the agent has stopped and the work can be reviewed. It does not mean the PR is ready to merge. The icon vocabulary makes that distinction harder to scan.

**Classification:** Misleading presentation, not an incorrect task status.

**Suggested direction:** Use an explicit label such as **Ready for review** and give the current blocking PR condition readable text near the next action. Keep agent progress and PR readiness distinct.

### UI-02: “Up to date with GitHub” obscures the remaining conflict

**Where:** The same task's **Changes** panel after its push.

**Observed:** **Branch pushed** and **Up to date with GitHub** appear in the publication panel, while GitHub and the PR badge still show a conflict. The panel's PR link says **Open pull request** without explaining the blocker there.

**Why it feels wrong:** The successful transfer is presented as a terminal success state. A developer who just asked to resolve a conflict can reasonably think the task worked.

**Classification:** Ambiguous success wording. The underlying conflict-publication failure is confirmed separately as SIM-05.

**Suggested direction:** Say what is synchronized, then show what still prevents the PR from proceeding. For this case: the branch matches GitHub, but it still conflicts with `main` and has no checks on the latest revision.

### UI-03: two tasks have exactly the same visible identity

**Where:** Sidebar and [project PR list](http://127.0.0.1:5285/#project/811f61d0-b6b1-438c-b5f8-e77df4350a03/prs).

**Observed:** Re-importing #4 produced two tasks named `#4 · feat: prioritize open support tickets`. The sidebar truncates them identically. The PR row presents two adjacent, identical task links plus the original feature task.

**Why it feels unnatural:** The user sees duplicated links without an explanation of which is the reproduction, the repair, or the latest workspace. Even expanding the full title would not disambiguate them.

**Suggested direction:** Name or annotate the purpose and revision of each attempt. Group task history for a PR and identify the active continuation. This should not depend on the user manually renaming every import.

### UI-04: “Work on PR” encourages another task even when work already exists

**Where:** The project PR list, including #4 with three linked tasks.

**Observed:** Every row's prominent action remains **Work on PR**. Clicking it starts a separate workspace. Existing tasks are smaller text links, and nothing in the button label says a new task will be created. The dialog then defaults to a review-only agent, although “work” could mean review, repair, or conflict resolution.

**Why it feels unnatural:** A user trying to continue the existing work is led toward creating another copy. This compounds UI-03 and requires interpreting the dialog before proceeding.

**Suggested direction:** Make continuing existing work the obvious action when appropriate. Make a separate workspace explicit, and distinguish review from implementing feedback.

### UI-05: repeated timeline events add noise without explaining what changed

**Where:** PR #4 repair conversation after publication.

**Observed:** Two events say **main is 2 commits ahead**, both followed by **CI has settled; integrate the newer base before the final validation**. One appears before the push and one after it. Their revision context is not visible in the collapsed text.

**Why it feels duplicated:** The internal observations may refer to different heads, but the user receives the same instruction twice. The second item does not say whether it is new information or the old problem still being present.

**Suggested direction:** Group repeated observations, or explain the change in state. Keep a latest actionable blocker and preserve earlier evidence in expandable history.

### UI-06: review decisions and their comments are fragmented

**Where:** PR #4 timeline.

**Observed:** **WastedHippie left feedback** and **WastedHippie requested changes** appear as separate nearby entries with overlapping descriptions of the same priority bug. The collapsed inline feedback truncates the requested fix mid-sentence.

**Why it feels harder:** The developer must open multiple entries and decide whether they describe one review or independent requests. Full text is available on expansion, so this is not missing data.

**Suggested direction:** Group a formal review and its inline discussions together, with a clear decision and comment count. Keep each discussion individually addressable. Avoid deleting the decision merely because its text overlaps a comment.

### UI-07: past success and current status compete for attention

**Where:** Task conversation and its saved summary.

**Observed:** An older **Tests passed** event remains near the current repair even though the latest pushed revision has no GitHub checks. The agent's historical response says **Nothing pushed or published**, followed by a real push event. Earlier in the run, an optional saved summary also wrongly claimed unpublished or blocked state after those states changed.

**Classification:** The saved-summary error was fixed as SIM-03. The historical entries are accurate for their time, but their relationship to the current revision is easy to miss.

**Suggested direction:** Keep a concise current state distinct from the historical turn report. Label check results with their revision or group history by publication. Do not rewrite old agent responses or relabel old passing checks as current evidence.

### UI-08: diff counts and revision labels need a stated comparison

**Where:** PR #4 **Review 6 files** and **Changes**.

**Observed:** The turn review contains six files, including merged base changes. The committed-changes panel shows three files. The review also exposes a short workspace hash that differs from the published GitHub head.

**Why it feels inconsistent:** The views use different baselines, but the user sees conflicting counts and an unexplained hash. During conflict recovery this creates doubt about whether files were lost.

**Suggested direction:** State what each view compares. Distinguish workspace revision from published revision. Keep full hashes available for investigation, but do not use an unlabeled hash as the primary explanation of the view.

### UI-09: blockers are visually quieter than routine metadata

**Where:** PR list and task header, observed at the normal desktop viewport.

**Observed:** **Conflicts** is a muted item at the end of **Checks passed · No review decision · Conflicts**. The branch name has its own line, while the blocker shares a small secondary line with routine status. In the task header the same problem is largely icon-based.

**Why it feels out of place:** The information needed to choose the next action has less emphasis than routine identity and success information.

**Suggested direction:** Give blocking conditions a clearer text treatment and ordering. This is a visual-priority observation, not a measured color-contrast or accessibility failure. No contrast-ratio claim is made.

### UI-10: the team view omits the teammate

**Where:** Project PR list and account selection dialogs.

**Observed:** PR rows show title, number, branch, checks, review state, and task links, but no visible author. The default account choice says **Use project default (machine default)** rather than showing the resolved login.

**Why it feels incomplete:** In a three-account collaboration test, branch names such as `nerilo/c29a51fa` tell the developer less than who authored the PR and who the next action will run as. I used independent GitHub checks to establish the author.

**Suggested direction:** Show author and resolved acting account where they help the user decide. Keep branch details available, but give team identity higher priority than generated branch identifiers.

### UI-11: long diff review has competing scroll surfaces

**Where:** The expanded queue implementation/test diff with **Changes** open.

**Observed:** Long code lines require horizontal scrolling, the large diff has its own vertical scrolling, and the publication panel remains separately scrollable. In the inspected scrolled state, the task heading was outside the visible review content while the side panel still occupied substantial width.

**Why it can feel awkward:** The user has to manage both code-reading position and publication controls. Opening the side panel leaves less width for code and makes horizontal scrolling more likely.

**Suggested direction:** Validate clear scroll ownership and persistent task/file context, and make a full-width review easy to discover. This is a design concern observed at the desktop viewport, not a completed responsive-layout finding. No mobile claim is made.

### UI-12: the PR page makes completed collaboration harder to revisit

**Where:** Project PR list.

**Observed:** The page shows **Open · 3** with search but no visible state selector. The merged #3 and #6 and the closed duplicate #5 are absent there; their task links and GitHub pages remain available elsewhere.

**Why it adds friction:** Reviewing the outcome of a team's work requires switching context to old tasks or GitHub. Search on this screen looks like PR search but covers only the open list.

**Suggested direction:** Make the scope of search explicit and offer an accessible route to merged/closed history if this screen is intended to support a team's full work cycle.

## Information verified during the audit

- The current PR list correctly changed #4 from **Checks passed** to **No checks** after the new push. It did not keep showing an old passing result as the current badge.
- #7 and #8 correctly show both passing checks and conflicts. Those facts can coexist; the combination is not a data error.
- Explicit account selection produced the expected GitHub PR author without changing the active machine-wide CLI account.
- Review drafts survived reload, and complete/archive/restore retained the task history and files.
- The local verification result and GitHub check result are separate evidence. Both should remain available, with clearer revision context rather than collapsing them into one generic green status.

## Priority and scope

First fix the underlying publication failure, then make blocking state and current revision unmistakable (UI-01, UI-02, UI-07, UI-08). Next address duplicate/fragmented work navigation (UI-03 through UI-06), then team identity and visual polish.

This pass did not measure contrast ratios, run a full screen-reader audit, test every viewport, or inspect every settings page. These notes record what was actually seen rather than inventing defects in untested screens.
