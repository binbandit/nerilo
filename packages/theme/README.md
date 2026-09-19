# Nerilo Astryx theme

The shared Astryx 0.5.4 theme used by the Nerilo app, with a separate component preview.

`src/nerilo.ts` is the editable source. `dist/` contains the generated CSS, theme module, and TypeScript declarations. Keep these together and regenerate them after changing the source. Do not edit generated files directly.

## Run

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/theme build
bun run --cwd packages/theme check
bun run --cwd packages/theme preview:dev
```

The local preview runs at http://127.0.0.1:5184. The production preview is built with `bun run preview:build` and served with `bun run preview:start`. Both scripts explicitly run Next.js under Bun. The production build includes TypeScript checking; `preview/tsconfig.json` enables strict mode.

The preview uses real Astryx `Theme`, `Heading`, `Text`, `ChatComposer`, `Selector`, `Button`, `Badge`, and `Card` components. It exercises input, selection, decisions, disabled and loading states, and light/dark appearance. Task data is illustrative; no action launches an agent or changes a repository policy.

## App integration

Import the generated theme module and CSS together. The Bun workspace uses these exports:

```tsx
'use client';

import {Theme} from '@astryxdesign/core';
import {neriloTheme} from '@nerilo/theme';
import '@nerilo/theme/theme.css';

export function NeriloTheme({children}: {children: React.ReactNode}) {
  return <Theme theme={neriloTheme} mode="system">{children}</Theme>;
}
```

Load Astryx's reset and component CSS before the theme. Declare the layer order explicitly: `reset, astryx-base, astryx-theme`, followed by the application's own layer. The preview demonstrates this without a custom StyleX compiler or Tailwind.

Operational headings use DM Sans. `Heading` with `type="editorial"` opts into the large DM Serif Display treatment while preserving a semantic heading level. The generated declaration file registers this variant. Avoid using the editorial style for every task title.

The theme names fonts but does not load them. The preview uses `next/font/google` to download and self-host DM Sans and DM Serif Display at build time, then maps the generated font variables onto theme roles. A fresh build requires access to the font provider; vendor licensed font files with `next/font/local` if fully offline builds become a requirement.

## Validation

Verified on 9 September 2026 with Bun 1.4.2, Next.js 16.3.4, React 19.2.8, and Astryx 0.5.4:

- Theme compilation and generated-output consistency check.
- Production prerender/build and strict TypeScript checking.
- Browser interaction with composer, agent selector, decision controls, and appearance toggle.
- Desktop and narrow layout inspection in light and dark appearance.
- Resolved-token contrast checks for primary text, secondary text on the muted surface, and primary/success/warning/error labels in both modes. These are targeted checks, not a complete accessibility audit.

Pin Astryx while it is in beta. Rebuild and visually check the theme when upgrading. The prototype wordmark is text, not the final production logo.

References: [Astryx theme documentation](https://astryx.atmeta.com/docs/theme), [Next.js setup](https://github.com/facebook/astryx/tree/main/apps/example-nextjs), [component catalog](https://astryx.atmeta.com/components).
