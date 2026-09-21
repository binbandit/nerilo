# Nerilo product and visual direction

Status: product direction from 9 September 2026, with visual alignment updated 19 September 2026.

## Product position

Nerilo is a calm place to direct AI agents and bring work to completion. The first useful product is a coding-agent harness running isolated tasks on the user's machine, with an architecture that can later support remote execution and other kinds of work.

The moodboard's campaign and customer-insight examples suggest a broader eventual audience. They are not evidence that the first release must support all knowledge work. Keep the durable task and artifact model general, while making the initial repository workflow excellent.

## What the moodboard says

The [moodboard](../assets/nerilo.png) combines Mediterranean light, tactile plaster, paper, terracotta steps, cobalt walls, yellow striped fabric, and a lemon. It feels optimistic and useful. Its central message is room to make: less managerial pressure, more agency and space to think.

The rounded lowercase wordmark has weight and friendliness. A contrasting editorial serif gives major headings elegance. Handwritten notes add a human touch in the brand world. The arch-shaped `n` suggests an original compact mark; the raster board is a reference, not a finished production logo asset.

Translate the materials into interface behavior: generous space around important decisions, calm backgrounds, clear hierarchy, and a reassuring sense of progress. Keep photo collage, handwriting, and paper texture mostly in onboarding, empty states, and brand material. Dense working screens need clean, legible surfaces.

## Interface principles

| Product principle                  | Nerilo presentation                                             |
| ---------------------------------- | --------------------------------------------------------------- |
| Compact sidebar and task hierarchy | Warm chalk sidebar, cobalt selection, readable task titles      |
| Prompt as the primary entry        | Spacious composer beneath an editorial greeting                 |
| Timeline of consequential turns    | Clear milestones and quiet expandable activity                  |
| Evidence beside the work           | Crisp artifact rail with previews, checks, and change summaries |
| Minimal interruptions              | Specific questions only when the user's judgment is needed      |
| Fast keyboard operation            | Discoverable shortcuts without permanent shortcut wallpaper     |
| Many concurrent tasks              | Readable grouped lists with status text and small symbols       |

The first impression should be bright and composed. Keep the primary light design free of multicolored dark gradients. A dark palette can retain warm charcoal and gentle blue rather than become neon.

## Working color tokens

The screen palette restores the moodboard's clear cobalt, chalk, terracotta, and butter yellow. White working surfaces sit against a lightly warmed canvas; blue carries the brand and selected states. The welcome screen pairs a high-contrast serif with a small arch on a butter tile. Working screens keep the existing compact task hierarchy and open reading area.

The compact New task action uses solid cobalt. The home composer gives the prompt 16 px text, a quiet paper shadow, and a divider above its settings. Sidebar project names anchor each group; ready, paused, failed, and completed tasks use distinct symbols as well as color. The browser icon carries the same arch as the welcome screen.

| Role       | Light value | Use                                        |
| ---------- | ----------- | ------------------------------------------ |
| Chalk      | `#FAF9F6`   | Main canvas                                |
| Paper      | `#FFFFFF`   | Composer and evidence surfaces             |
| Warm stone | `#F3F1EB`   | Sidebar                                    |
| Cobalt     | `#285BB5`   | Wordmark, primary action, links, selection |
| Blue wash  | `#E7EEFA`   | Selected rows and quiet primary controls   |
| Blue ink   | `#1E4487`   | Editorial welcome heading                  |
| Ink        | `#303B53`   | Body text and operational headings         |
| Muted ink  | `#646D7B`   | Secondary information                      |
| Terracotta | `#B9573C`   | Brand accents, sparingly                   |
| Butter     | `#F7E8A5`   | Arch tile and attention with dark text     |
| Olive      | `#576D54`   | Verified and complete, paired with a check |
| Error ink  | `#A05247`   | Actual failures, paired with explanation   |
| Border     | `#E3E2DC`   | Subtle separation                          |

Use cobalt as the dominant interactive color. Yellow needs dark text; it should never serve as small text on white. Terracotta is not the universal warning color. Status meaning must survive grayscale and color-vision differences through wording and symbols. Validate actual contrast in implementation, including hover, disabled, and focus states.

## Typography and geometry

Use Astryx for the component foundation. The first [Nerilo theme and component preview](../../packages/theme/README.md) implements this palette through Astryx's supported theme API. See the [integration notes](../architecture/astryx-integration.md) for component mapping, font loading, and Next.js setup.

- Bodoni Moda for the welcome and occasional editorial introductions; DM Sans for everything operational; monospace only for code, identifiers, and logs. The compact wordmark and arch are scalable SVG interpretations of the moodboard, separate from interface typography.
- A working task title stays compact and sans serif. The large serif should not consume valuable conversation space on every task.
- Suggested scale: 44-60 px desktop home heading, 36-48 px mobile home heading, 22-28 px page title, 14-15 px body, 12-13 px metadata. Comfortable line length and clear contrast matter more than fitting more tiny text.
- Sidebar 264 px, narrowing to 248 px before becoming a mobile drawer; optional evidence rail about 280-320 px; main conversation takes remaining room. Collapse the rail before compressing the reading column.
- Controls around 36 px tall on desktop and at least 44 px effective touch targets. Use 8-12 px surface radii, with a slightly softer composer. Crisp dividers should do most of the grouping.
- Use motion to reveal state changes and maintain spatial continuity. Respect reduced motion. Continuous ornamental flock animation is unnecessary in a workspace people read all day.

The app and theme preview self-host DM Sans and Bodoni Moda through Next.js. These are chosen for their roles and visual fit; the moodboard does not identify its original typefaces.

## Information architecture

The sidebar is the primary navigation, grouping tasks beneath projects. Home is a starting point with a composer; project views and Archive retain their scoped task lists. Compact toolbar actions provide search, filtering, and New task. Agents, Library, and Settings live in the workspace menu. See the [sidebar direction](sidebar-and-pr-direction.md) for the current navigation decisions.

Project views answer three questions: what needs me, what is moving, and what is ready to review. Keep these visible as grouped rows. Do not create ambiguous separate destinations called Tasks, Runs, Sessions, Jobs, and Agents for the same work item.

Use “task” for the work the user asked for, “agent” for who is doing it, and “run” only when an execution attempt matters. A project's environment can appear as “On this Mac” with details on demand; Docker identifiers belong in diagnostics.

## Core screens

### Home and project views

Home has a brief welcome and primary composer. Project views add a small number of task groups, with clear titles and current states. “Waiting for your decision” deserves more prominence than elapsed time or estimated spend.

### Task

Task title and state at the top. Conversation and consequential milestones in the main column. Show author, cause, outcome, and time without repeating the complete prompt in several places. Keep follow-up input anchored within the task and preserve drafts during navigation and reconnects.

The evidence rail contains change summary, exact reviewed commit when relevant, checks, screenshots, preview, and PR. Put the decision alongside the evidence. “Ready to review” means there is evidence to inspect; it does not mean the model said “done.”

### Review

A dedicated wide view for file navigation, unified/split changes, inline comments, and verification results. Returning to the task should preserve position. Screenshots and browser previews are equally important for visual work.

### Environment and settings

First setup should establish a project, working execution environment, and agent connection with a successful readiness check. Advanced networking, image details, and resource limits can expand progressively. Error copy names the cause and the next action: Docker stopped, image unavailable, setup failed, credentials expired, or capacity exhausted.

## State design

| State           | User-facing meaning                             | Expected presentation                                              |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| Queued          | Waiting for execution capacity                  | Explain why; keep cancel available                                 |
| Preparing       | Preparing this task's environment               | Current setup step and useful progress                             |
| Working         | Agent is executing a turn                       | Latest activity and stop control                                   |
| Checking        | Verifying the result                            | Checks and artifacts tied to this revision                         |
| Needs you       | A specific decision or approval blocks progress | Visible question and bounded choices                               |
| Ready to review | Work is ready for human assessment              | Evidence and review entry                                          |
| Waiting         | Waiting for CI, external review, or a schedule  | State the dependency, not a generic spinner                        |
| Paused          | Execution stopped while work is retained        | Explain what resumes and what is preserved                         |
| Failed          | Execution could not proceed                     | Cause, retained work, and recovery action                          |
| Complete        | Completion criteria have been met               | Clear outcome and retained evidence                                |
| Connection lost | This browser cannot reach the daemon            | Last confirmed state and retry; don't falsely mark the task failed |

These are display states derived from separate task, turn, container, and connection states. They should not all be forced into one backend enum.

## Product voice

Friendly, specific, and measured. Use “New task,” “Working on it,” “Ready to review,” “Needs your input,” “Continue,” and “View changes.” Avoid jargon such as spawn, resurrect, terminate substrate, and provision worker in primary flows.

“Room to make.” belongs in the brand and a quiet home greeting. Error messages should prioritize useful information. Warmth comes from helping users retain confidence and control, not from inserting cheerful slogans into failures.

## Initial acceptance bar

The first interface must work with long task names, multiple projects, empty lists, hundreds of events, a blocked decision, a changed PR head, interrupted work, a stopped daemon, and a narrow window. A deterministic scenario panel should exercise those states. Prototype the whole task loop before expanding the settings catalog.

## Interaction refinement

Assume users have used agent tools before. Familiar controls should carry familiar meaning. Prefer spacing, alignment, and surface changes over extra headings and explanations. Reserve help text for consequential choices, unexpected behavior, and recovery from errors.

The app uses one task header and groups each request with its result. Earlier turns collapse; intermediate steps, checks, files, and session metadata expand on demand. Everyday settings use direct names rather than editorial slogans. The serif and warmer brand expression stay concentrated on the home screen.
