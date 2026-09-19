# Astryx integration

Decision: use Astryx as Nerilo's component foundation, per the user's preference. Verified 9 September 2026 against the public website and the published 0.5.4 CLI/core packages.

## Fit and implementation

Astryx supports React 19+, has official Next.js examples, and ships compiled component CSS. Custom app layouts can use ordinary CSS without installing a StyleX compiler. Its supported theme API covers semantic tokens, typography, geometry, component states, and custom variants. [Getting started](https://astryx.atmeta.com/docs/getting-started), [official repository](https://github.com/facebook/astryx).

The website's Themes and Playground are useful visual references. For Nerilo, a source-controlled `defineTheme` file is the reproducible source of truth. The official CLI compiles it to CSS and a built theme object so the initial server-rendered page has its styles before hydration. No public theme publication or account was required. [Theme API](https://astryx.atmeta.com/docs/theme), [CLI](https://astryx.atmeta.com/docs/cli).

The implemented [theme package](../packages/theme/README.md) translates the moodboard into chalk and paper surfaces, warm stone, cobalt actions, terracotta accents, butter attention states, and a warm dark counterpart. Ordinary controls stay sans serif. A typed `editorial` heading variant provides the contrasting serif for welcome screens.

The accompanying Next.js preview uses real Astryx components. It is independent of the broader interactive layout sketch and does not implement the task backend. Font loading and CSS layer ordering are part of the integration, rather than assumed side effects of selecting a theme.

## Component direction

| Nerilo surface | Astryx starting point |
| --- | --- |
| Application frame and navigation | AppShell, SideNav, TopNav |
| Starting and following up on tasks | ChatComposer and its input/footer slots |
| Conversation | ChatMessage family, Text, Heading |
| Project and agent selection | Selector, CommandPalette where appropriate |
| Decisions | Button, Card, Dialog only when the action warrants a modal |
| Status and verification | Badge, Banner, ProgressBar, expandable details |
| Dense work lists and settings | Table, form fields, tabs, layout primitives |

These are component candidates, not a promise that every item has already been integrated. Read each installed component's actual API before implementation. Preserve native focus, keyboard, and accessibility behavior. Build the code-diff and artifact experience around the relevant specialized renderer when the generic component catalog is insufficient.

## Constraints to preserve

- Use the built theme object with its CSS in Next.js. Runtime injection alone can flash component overrides during hydration.
- Use semantic token pairs. Hand-overriding colors requires checking foregrounds and backgrounds together, including dark mode and status colors.
- Keep app layout styling separate from theme component styling. Avoid targeting private internal variables or globally overriding all buttons and headings.
- Pin core and CLI together during the beta period. Rebuild declarations and recheck components when upgrading.
- This successful theme-preview build establishes basic Next.js/Bun compatibility. It does not establish daemon, Docker, packaging, or recovery correctness.

The theme source, generated assets, build command, and preview are committed-file candidates. The local `node_modules` and build caches are ignored.
