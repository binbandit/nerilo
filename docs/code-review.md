# Reviewing agent changes

Choose **Review files** below an agent response, or **Review changes** in task actions. The turn menu lets you inspect earlier results. Each review stays tied to that turn's revision.

Hover over a code line and use its comment icon. Added and context lines refer to the resulting file; deleted lines refer to the original file. Write several comments, edit or remove them, then choose **Send review**. While the agent is working, **Queue review** adds the feedback to its follow-up queue.

Drafts save as you type in this browser, separately for each machine, task, turn, and revision. **Done** closes the editor without sending. Escape does the same; the configured multiline-submit shortcut also finishes editing. Use the configured row-navigation shortcuts to move between line comment buttons. A failed submission keeps the draft available for another attempt.

The follow-up contains the exact file path, old/new side, line, code excerpt, and reviewed base and head revisions. The agent is asked to check the current workspace before editing because later turns may have changed it. Queued and completed review requests use a compact comment-count label; the full request remains available as review context.

## Boundaries

- Feedback goes to the task's agent. It does not post a GitHub review.
- Browser drafts do not synchronize across devices. Once sent, the daemon owns the queued request.
- Each batch supports up to 50 comments, 4,000 characters per comment, within the existing 30,000-character follow-up limit.
- Binary files and malformed or incomplete diff hunks cannot receive line comments. Archived tasks/projects and truncated results are read-only.
- Export and apply actions are available only on the latest turn, with their existing workspace checks.

## Validation

The parser is covered for multi-hunk line accounting, added/deleted files, renames, binary files, quoted and Unicode paths, incomplete hunks, saved drafts, and structured prompts. API tests cover review labels, invalid metadata, duplicate request keys, ordinary follow-ups, and failed-turn retries.

Browser checks used an isolated daemon with agent execution disabled. They covered added/deleted line comments, editing/removal, keyboard focus, refresh recovery, historical-turn separation, failed-send recovery, real queue submission, and light/dark and 390px layouts. This validates the review-to-queue path without claiming a new live model editing run.
