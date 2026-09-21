# Sidebar and PR direction

Updated 9 September 2026.

## Sidebar principles

The sidebar is a live outline of work: workspace, task, and attached PR state. General application navigation does not sit above that outline. Project controls appear in context. Search/filter and creation are compact toolbar actions; account and configuration live at the bottom.

A task's PR indicators separate review disposition from CI and lifecycle. Approval and failing checks can coexist. Merged and closed PRs use terminal-state icons. Multiple PRs collapse into one count or stack, with detail revealed in a floating panel. These signals let a user scan for work that needs a decision.

## Nerilo's choices

Keep the work hierarchy, independent PR signals, compact controls, and progressive disclosure. Give task titles enough sidebar width to be useful. Remove the generic My work / Projects / Agents / Library navigation stack and the large New task button. Put configuration in one workspace menu; use repository headers as actual expand/collapse controls. Hide incidental project actions until hover or keyboard focus, while retaining them on touch layouts.

Use quieter warm light surfaces and a neutral dark palette. Reserve typography and color for hierarchy; avoid the reference's decorative multicolored gradients. Agent output sits in an open reading area, with a softly distinguished request and a composer near the bottom. Local verification belongs with its result rather than in a full-width warning banner.

PR details open deliberately by click or keyboard through an Astryx Popover. This makes touch and keyboard behavior predictable. The sidebar uses compact status glyphs without a PR number. A small numbered chip in the task header opens the same details. Review and CI have separate indicators; merged PRs use a purple merge icon. A task with several PRs shows its primary signal plus a count of additional links. Mixed terminal states remain neutral instead of implying they all merged. Stale reads retain the last known state with an update-unavailable indication.

## Implemented PR scope

Task actions include Link pull request. Nerilo reads the linked GitHub PR through the Mac's existing GitHub CLI login using [gh pr view](https://cli.github.com/manual/gh_pr_view). The daemon stores review, checks, lifecycle, conflicts, and branch metadata. Unarchived task links refresh periodically; individual PRs can be refreshed or unlinked in the panel. These background reads do not modify GitHub. Explicit push and PR creation are available through Git in the task header; newly created PRs appear here automatically.

Project menus discover open repository PRs. Opt-in Autopilot creates and maintains a task PR, reacts to CI/review events, and can squash-merge after repository requirements pass. Those explicitly configured actions are separate from passive PR status refresh. The current sidebar shows PRs only when a real link has been attached to a task.

Validation used an isolated test workspace for conflicting, running, and merged states, plus a real read of a public Astryx PR through the linking UI. No sample PRs were added to the user's tasks.

## September 10 extension

Project menus now include an open-PR view. Discovered PRs can be linked to existing tasks or used to start a fresh task at an exact PR revision. This extends the sidebar's PR context into execution without turning status updates into automatic agent launches. A linked PR and a task's pinned workspace revision are separate concepts.

The global home view is a starting point; task navigation remains in the sidebar. Project views and Archive retain their scoped lists. Long conversation prompts and sidebar task names shrink within their grid columns. The collapsed sidebar control has dedicated header space.

The composer model picker uses three compact submenu rows for provider, model, and effort, with current values and selection checkmarks. Choices save immediately; only a custom model ID opens a small text-entry dialog. Keyboard navigation and focus remain inside the menu until dismissal.

Projects and task rows can be dragged to reorder. Task order stays within each project, leaving its repository and workspace unchanged. A thin insertion line shows the drop position. Alt + Up/Down moves the focused row with a screen-reader announcement. Order is stored in daemon settings, shared across browser tabs, and maintained across filtering, archive/restore, and ordinary settings changes. New items follow saved manual positions. Dragging and keyboard movement were exercised against the running app, including a reload to verify persistence.

Live PR presentation was checked against the real Nerilo lifecycle PRs on September 10. Sidebar rows retain their normal height; the header chip and sidebar signal both open the PR details without navigating away from the task. See [the lifecycle demonstration](../reviews/lifecycle-demo.md).
