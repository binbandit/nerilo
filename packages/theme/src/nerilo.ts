import { defineTheme } from "@astryxdesign/core/theme";

/** Nerilo's working surfaces. Display typography is an explicit opt-in. */
export const neriloTheme = defineTheme({
  name: "nerilo",
  color: {
    accent: ["#285BB5", "#B2C5EB"],
    neutralStyle: "warm",
    contrast: "standard",
  },
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: {
      family: "DM Sans",
      fallbacks: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    heading: { weight: "medium" },
    code: {
      family: "ui-monospace",
      fallbacks: '"SF Mono", Consolas, monospace',
    },
  },
  radius: { base: 4, multiplier: 1 },
  motion: { fast: 140, medium: 240, ratio: 0.75 },
  tokens: {
    "--color-accent": ["#285BB5", "#B2C5EB"],
    "--color-on-accent": ["#FFFFFF", "#273247"],
    "--color-accent-muted": ["#E7EEFA", "#354052"],
    "--color-text-accent": ["#285BB5", "#B2C5EB"],
    "--color-icon-accent": ["#285BB5", "#B2C5EB"],
    "--color-background-body": ["#FAF9F6", "#242628"],
    "--color-background-surface": ["#FFFFFF", "#292C2F"],
    "--color-background-card": ["#FFFFFF", "#292C2F"],
    "--color-background-popover": ["#FFFFFF", "#313539"],
    "--color-background-muted": ["#F1EFE9", "#2C2F32"],
    "--color-text-primary": ["#303B53", "#E7E8E6"],
    "--color-text-secondary": ["#646D7B", "#ACB0B4"],
    "--color-icon-primary": ["#303B53", "#E7E8E6"],
    "--color-icon-secondary": ["#646D7B", "#ACB0B4"],
    "--color-border": ["#E3E2DC", "#3C4044"],
    "--color-border-emphasized": ["#817F78", "#89929F"],
    "--color-overlay": ["#24262855", "#10121488"],
    "--color-overlay-hover": ["#2034520B", "#F0EDE510"],
    "--color-overlay-pressed": ["#20345217", "#F0EDE51C"],
    "--color-success": ["#576D54", "#B4C8A8"],
    "--color-success-muted": ["#E9EEE4", "#35412F"],
    "--color-on-success": ["#FFFEFA", "#192A20"],
    "--color-warning": ["#F7E8A5", "#D6C58D"],
    "--color-warning-muted": ["#FBF4D7", "#48432F"],
    "--color-on-warning": ["#564621", "#332B16"],
    "--color-error": ["#A05247", "#DFADA0"],
    "--color-error-muted": ["#F3E7E1", "#463731"],
    "--color-on-error": ["#FFFEFA", "#361D19"],
    "--size-element-sm": "32px",
    "--size-element-md": "36px",
    "--size-element-lg": "44px",
    "--text-supporting-size": "0.8125rem",
    "--radius-chat": "18px",
    "--focus-outline-color": "var(--color-accent)",
  },
  localTokens: {
    "--astryx-theme-nerilo-color-clay": ["#B9573C", "#D8A68C"],
    "--astryx-theme-nerilo-color-sidebar": ["#F3F1EB", "#1F2224"],
    "--astryx-theme-nerilo-color-display": ["#1E4487", "#B2C5EB"],
    "--astryx-theme-nerilo-color-butter": ["#F7E8A5", "#48432F"],
    "--astryx-theme-nerilo-font-display": '"Bodoni Moda", Georgia, serif',
  },
  components: {
    badge: {
      "variant:info": {
        backgroundColor: "var(--color-accent-muted)",
        color: "var(--color-text-accent)",
      },
      "variant:success": {
        backgroundColor: "var(--color-success-muted)",
        color: "light-dark(#4D674A, #BCD0B0)",
      },
      "variant:warning": {
        backgroundColor: "var(--color-warning-muted)",
        color: "light-dark(#6D5C2E, #DED09B)",
      },
      "variant:error": {
        backgroundColor: "var(--color-error-muted)",
        color: "light-dark(#954E44, #E0B0A5)",
      },
    },
    button: { base: { fontWeight: "500" } },
    heading: {
      "type:editorial": {
        fontFamily: "var(--astryx-theme-nerilo-font-display)",
        fontSize: "clamp(2.75rem, 5vw, 3.75rem)",
        fontWeight: "400",
        lineHeight: "1.08",
        letterSpacing: "-0.025em",
      },
    },
  },
});
