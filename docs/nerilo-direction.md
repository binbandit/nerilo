# Nerilo product and visual direction

Status: initial proposal informed by the repository moodboard, 9 September 2026.

## Product position

Nerilo is a calm place to direct AI agents and bring work to completion. The first useful product is a coding-agent harness running isolated tasks on the user's machine, with an architecture that can later support remote execution and other kinds of work.

The moodboard's campaign and customer-insight examples suggest a broader eventual audience. They are not evidence that the first release must support all knowledge work. Keep the durable task and artifact model general, while making the initial repository workflow excellent.

## What the moodboard says

The [moodboard](/Users/brayden/Developer/ai/nerilo/nerilo.png) combines Mediterranean light, tactile plaster, paper, terracotta steps, cobalt walls, yellow striped fabric, and a lemon. It feels optimistic and useful. Its central message is room to make: less managerial pressure, more agency and space to think.

The rounded lowercase wordmark has weight and friendliness. A contrasting editorial serif gives major headings elegance. Handwritten notes add a human touch in the brand world. The arch-shaped `n` suggests an original compact mark; the raster board is a reference, not a finished production logo asset.

Translate the materials into interface behavior: generous space around important decisions, calm backgrounds, clear hierarchy, and a reassuring sense of progress. Keep photo collage, handwriting, and paper texture mostly in onboarding, empty states, and brand material. Dense working screens need clean, legible surfaces.

## Interface principles

| Product principle | Nerilo presentation |
| --- | --- |
| Compact sidebar and task hierarchy | Warm chalk sidebar, cobalt selection, readable task titles |
| Prompt as the primary entry | Spacious composer beneath an editorial greeting |
| Timeline of consequential turns | Clear milestones and quiet expandable activity |
| Evidence beside the work | Crisp artifact rail with previews, checks, and change summaries |
| Minimal interruptions | Specific questions only when the user's judgment is needed |
| Fast keyboard operation | Discoverable shortcuts without permanent shortcut wallpaper |
| Many concurrent tasks | Readable grouped lists with status text and small symbols |

The first impression should be bright and composed. Keep the primary light design free of multicolored dark gradients. A dark palette can retain warm charcoal and gentle blue rather than become neon.

## Working color tokens

These screen colors were softened after the first app review. They interpret the textured moodboard rather than sample it literally.

| Role | Light value | Use |
| --- | --- | --- |
| Chalk | `#FAF8F3` | Main canvas |
| Paper | `#FFFEFA` | Composer and evidence surfaces |
| Warm stone | `#F0EDE5` | Sidebar and restrained secondary surfaces |
| Cobalt | `#4566A5` | Primary action, links, active selection |
| Ink | `#303D50` | Body text and headings |
| Muted ink | `#626C77` | Secondary information |
| Terracotta | `#AE634B` | Brand accents, sparingly |
| Butter | `#F3E8B8` | Attention surface with dark text |
| Olive | `#576D54` | Verified and complete, paired with a check |
| Error ink | `#A05247` | Actual failures, paired with explanation |
| Border | `#E1DDD3` | Subtle separation |

Use cobalt as the dominant interactive color. Yellow needs dark text; it should never serve as small text on white. Terracotta is not the universal warning color. Status meaning must survive grayscale and color-vision differences through wording and symbols. Validate actual contrast in implementation, including hover, disabled, and focus states.

## Typography and geometry

Use Astryx for the component foundation. The first [Nerilo theme and component preview](../packages/theme/README.md) implements this palette through Astryx's supported theme API. See the [integration notes](astryx-integration.md) for component mapping, font loading, and Next.js setup.

- Editorial serif for welcome and occasional section introductions; a readable sans serif for everything operational; monospace only for code, identifiers, and logs.
- A working task title stays compact and sans serif. The large serif should not consume valuable conversation space on every task.
- Suggested scale: 40-52 px home heading, 22-26 px page title, 14-15 px body, 12-13 px metadata. Comfortable line length and clear contrast matter more than fitting more tiny text.
- Sidebar about 224-248 px; optional evidence rail about 280-320 px; main conversation takes remaining room. Collapse the rail before compressing the reading column.
- Controls around 36 px tall on desktop and at least 44 px effective touch targets. Use 8-12 px surface radii, with a slightly softer composer. Crisp dividers should do most of the grouping.
- Use motion to reveal state changes and maintain spatial continuity. Respect reduced motion. Continuous ornamental flock animation is unnecessary in a workspace people read all day.

Font names in a concept are exploratory. Final selection needs inspection at real working sizes and a deliberate license/self-hosting decision. Do not assume the board identifies a specific commercial typeface.

## Information architecture

Primary navigation: My work, then project groups and their recent tasks. A single New task action remains readily available. Secondary navigation can expose Agents (presets), Library (instructions, knowledge, workflows), and Settings when those capabilities exist.

My work answers three questions: what needs me, what is moving, and what is ready to review. Keep all three visible as grouped rows. Do not create ambiguous separate destinations called Tasks, Runs, Sessions, Jobs, and Agents for the same work item.

Use “task” for the work the user asked for, “agent” for who is doing it, and “run” only when an execution attempt matters. A project's environment can appear as “On this Mac” with details on demand; Docker identifiers belong in diagnostics.

## Core screens

### My work

A brief welcome, primary composer, and a small number of task groups. Each row includes a clear title, project, current state, and meaningful last development. “Waiting for your decision” deserves more prominence than elapsed time or estimated spend.

### Task

Task title and state at the top. Conversation and consequential milestones in the main column. Show author, cause, outcome, and time without repeating the complete prompt in several places. Keep follow-up input anchored within the task and preserve drafts during navigation and reconnects.

The evidence rail contains change summary, exact reviewed commit when relevant, checks, screenshots, preview, and PR. Put the decision alongside the evidence. “Ready to review” means there is evidence to inspect; it does not mean the model said “done.”

### Review

A dedicated wide view for file navigation, unified/split changes, inline comments, and verification results. Returning to the task should preserve position. Screenshots and browser previews are equally important for visual work.

### Environment and settings

First setup should establish a project, working execution environment, and agent connection with a successful readiness check. Advanced networking, image details, and resource limits can expand progressively. Error copy names the cause and the next action: Docker stopped, image unavailable, setup failed, credentials expired, or capacity exhausted.

## State design

| State | User-facing meaning | Expected presentation |
| --- | --- | --- |
| Queued | Waiting for execution capacity | Explain why; keep cancel available |
| Preparing | Preparing this task's environment | Current setup step and useful progress |
| Working | Agent is executing a turn | Latest activity and stop control |
| Checking | Verifying the result | Checks and artifacts tied to this revision |
| Needs you | A specific decision or approval blocks progress | Visible question and bounded choices |
| Ready to review | Work is ready for human assessment | Evidence and review entry |
| Waiting | Waiting for CI, external review, or a schedule | State the dependency, not a generic spinner |
| Paused | Execution stopped while work is retained | Explain what resumes and what is preserved |
| Failed | Execution could not proceed | Cause, retained work, and recovery action |
| Complete | Completion criteria have been met | Clear outcome and retained evidence |
| Connection lost | This browser cannot reach the daemon | Last confirmed state and retry; don't falsely mark the task failed |

These are display states derived from separate task, turn, container, and connection states. They should not all be forced into one backend enum.

## Product voice

Friendly, specific, and measured. Use “New task,” “Working on it,” “Ready to review,” “Needs your input,” “Continue,” and “View changes.” Avoid jargon such as spawn, resurrect, terminate substrate, and provision worker in primary flows.

“Room to make.” belongs in the brand and a quiet home greeting. Error messages should prioritize useful information. Warmth comes from helping users retain confidence and control, not from inserting cheerful slogans into failures.

## Initial acceptance bar

The first interface must work with long task names, multiple projects, empty lists, hundreds of events, a blocked decision, a changed PR head, interrupted work, a stopped daemon, and a narrow window. A deterministic scenario panel should exercise those states. Prototype the whole task loop before expanding the settings catalog.

## Interaction refinement

Assume users have used agent tools before. Familiar controls should carry familiar meaning. Prefer spacing, alignment, and surface changes over extra headings and explanations. Reserve help text for consequential choices, unexpected behavior, and recovery from errors.

The app uses one task header and groups each request with its result. Earlier turns collapse; intermediate steps, checks, files, and session metadata expand on demand. Everyday settings use direct names rather than editorial slogans. The serif and warmer brand expression stay concentrated on the home screen.
