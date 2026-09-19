import { z } from "zod";

const definitions = [
  ["search", "Search tasks", "Workspace", "global", ["Mod+K"]],
  ["new-task", "New task", "Workspace", "global", ["Mod+J"]],
  ["sidebar", "Toggle sidebar", "Workspace", "global", ["Mod+B"]],
  ["settings", "Open settings", "Workspace", "global", ["Mod+Comma"]],
  ["help", "Keyboard shortcuts", "Workspace", "global", ["Mod+Slash", "?"]],
  ["composer", "Focus message", "Workspace", "global", ["Slash"]],
  ["next-region", "Next area", "Workspace", "global", ["F6"]],
  ["previous-region", "Previous area", "Workspace", "global", ["Shift+F6"]],
  ["row-next", "Next item", "Lists", "row", ["ArrowDown"]],
  ["row-previous", "Previous item", "Lists", "row", ["ArrowUp"]],
  ["row-first", "First item", "Lists", "row", ["Home"]],
  ["row-last", "Last item", "Lists", "row", ["End"]],
  ["row-expand", "Expand item", "Lists", "row", ["ArrowRight"]],
  ["row-collapse", "Collapse item", "Lists", "row", ["ArrowLeft"]],
  [
    "context-menu",
    "Item actions",
    "Lists",
    "row",
    ["Shift+F10", "ContextMenu"],
  ],
  ["reorder-up", "Move item up", "Lists", "row", ["Alt+ArrowUp"]],
  ["reorder-down", "Move item down", "Lists", "row", ["Alt+ArrowDown"]],
  ["submit-form", "Submit a single-line field", "Writing", "form", ["Enter"]],
  [
    "submit-multiline",
    "Submit a multiline form",
    "Writing",
    "multiline",
    ["Mod+Enter"],
  ],
  ["send-message", "Send message", "Writing", "composer", ["Enter"]],
  [
    "cancel-edit",
    "Cancel queued-message edit",
    "Writing",
    "multiline",
    ["Escape"],
  ],
] as const;

export type ShortcutAction = (typeof definitions)[number][0];
export type ShortcutBindings = Partial<Record<ShortcutAction, string[]>>;
export const shortcutDefinitions = definitions.map(
  ([id, label, group, scope]) => ({ id, label, group, scope }),
);
export const defaultShortcutBindings = Object.fromEntries(
  definitions.map(([id, , , , chords]) => [id, [...chords]]),
) as Record<ShortcutAction, string[]>;
export const shortcutActionSchema = z.enum(definitions.map(([id]) => id));
const modifiers = ["Mod", "Ctrl", "Meta", "Alt", "Shift"] as const;
const namedKeys = [
  "Enter",
  "Escape",
  "Tab",
  "Space",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Backspace",
  "Delete",
  "Insert",
  "ContextMenu",
  "Comma",
  "Period",
  "Slash",
  "Backslash",
  "Semicolon",
  "Quote",
  "Backquote",
  "Minus",
  "Equal",
  "Plus",
  "BracketLeft",
  "BracketRight",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
];
const aliases: Record<string, string> = {
  ",": "Comma",
  ".": "Period",
  "/": "Slash",
  "\\": "Backslash",
  ";": "Semicolon",
  "'": "Quote",
  "`": "Backquote",
  "-": "Minus",
  "=": "Equal",
  "+": "Plus",
  "[": "BracketLeft",
  "]": "BracketRight",
  " ": "Space",
  esc: "Escape",
};

export function normalizeShortcut(chord: string): string | null {
  const parts = chord.trim().split("+");
  const raw = parts.pop();
  if (
    !raw ||
    parts.some(
      (part) =>
        !modifiers.some((mod) => mod.toLowerCase() === part.toLowerCase()),
    )
  )
    return null;
  const mods = parts.map((part) =>
    modifiers.find((mod) => mod.toLowerCase() === part.toLowerCase())!,
  );
  if (
    new Set(mods).size !== mods.length ||
    (mods.includes("Mod") && (mods.includes("Ctrl") || mods.includes("Meta")))
  )
    return null;
  const key =
    aliases[raw.toLowerCase()] ??
    namedKeys.find((key) => key.toLowerCase() === raw.toLowerCase()) ??
    (/^[a-z0-9]$/i.test(raw)
      ? raw.toUpperCase()
      : /^[?!@#$%^&*()_:<>|{}~"]$/.test(raw)
        ? raw
        : null);
  if (!key) return null;
  return [...modifiers.filter((mod) => mods.includes(mod)), key].join("+");
}

export type ShortcutKey = {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  defaultPrevented?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
};
const shiftedSymbols = /^[?!@#$%^&*()_:<>|{}~"+]$/;
export function shortcutFromEvent(
  event: ShortcutKey,
  mac = false,
): string | null {
  if (
    event.isComposing ||
    event.nativeEvent?.isComposing ||
    ["Control", "Meta", "Alt", "Shift", "Dead", "Unidentified"].includes(
      event.key,
    )
  )
    return null;
  const mods: string[] = [];
  const rawKey =
    event.altKey && /^(Key[A-Z]|Digit[0-9])$/.test(event.code ?? "")
      ? event.code!.replace(/^(Key|Digit)/, "")
      : event.key;
  if (mac ? event.metaKey : event.ctrlKey) mods.push("Mod");
  if (mac ? event.ctrlKey : event.metaKey) mods.push(mac ? "Ctrl" : "Meta");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey && !shiftedSymbols.test(rawKey)) mods.push("Shift");
  const key = aliases[rawKey] ?? rawKey;
  return normalizeShortcut([...mods, key].join("+"));
}

function physicalChord(chord: string, mac: boolean) {
  return chord
    .split("+")
    .map((part) => (part === "Mod" ? (mac ? "Meta" : "Ctrl") : part))
    .sort()
    .join("+");
}
export function effectiveBindings(
  overrides: ShortcutBindings = {},
): Record<ShortcutAction, string[]> {
  return Object.fromEntries(
    shortcutDefinitions.map(({ id }) => [
      id,
      overrides[id] ?? defaultShortcutBindings[id],
    ]),
  ) as Record<ShortcutAction, string[]>;
}
export function matchesShortcut(
  event: ShortcutKey,
  action: ShortcutAction,
  overrides: ShortcutBindings = {},
  mac = false,
) {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.nativeEvent?.isComposing
  )
    return false;
  const pressed = shortcutFromEvent(event, mac);
  return Boolean(
    pressed &&
    (overrides[action] ?? defaultShortcutBindings[action]).some(
      (chord) => physicalChord(chord, mac) === physicalChord(pressed, mac),
    ),
  );
}

export function formatShortcut(chord: string, mac = false) {
  const labels: Record<string, string> = {
    Mod: mac ? "⌘" : "Ctrl",
    Meta: "⌘",
    Ctrl: mac ? "⌃" : "Ctrl",
    Alt: mac ? "⌥" : "Alt",
    Shift: mac ? "⇧" : "Shift",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Enter: "Enter",
    Escape: "Esc",
    ContextMenu: "Menu",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    Plus: "+",
    BracketLeft: "[",
    BracketRight: "]",
  };
  return chord
    .split("+")
    .map((part) => labels[part] ?? part)
    .join(mac ? " " : "+");
}

export function ariaShortcut(chord: string, mac = false) {
  const names: Record<string, string> = {
    Mod: mac ? "Meta" : "Control",
    Ctrl: "Control",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Semicolon: ";",
    Quote: "'",
    Backquote: "`",
    Minus: "-",
    Equal: "=",
    Plus: "+",
    BracketLeft: "[",
    BracketRight: "]",
  };
  return chord
    .split("+")
    .map((part) => names[part] ?? part)
    .join("+");
}

function reserved(chord: string, action: ShortcutAction) {
  const parts = chord.split("+");
  const key = parts.at(-1)!;
  if (
    key === "Enter" &&
    !parts.some((part) => ["Mod", "Ctrl", "Meta", "Alt"].includes(part)) &&
    !["submit-form", "submit-multiline", "send-message"].includes(action)
  )
    return true;
  if (
    ["submit-form", "submit-multiline", "send-message", "cancel-edit"].includes(
      action,
    ) &&
    !parts.some((part) => ["Mod", "Ctrl", "Meta", "Alt"].includes(part)) &&
    !["Enter", "Escape"].includes(key)
  )
    return true;
  if (
    ["Tab", "Space"].includes(key) ||
    (key === "Escape" && action !== "cancel-edit")
  )
    return true;
  if (["F1", "F5", "F11", "F12"].includes(key)) return true;
  if (
    parts.some((part) => ["Mod", "Ctrl", "Meta"].includes(part)) &&
    [
      "F",
      "L",
      "T",
      "W",
      "N",
      "R",
      "Q",
      "O",
      "P",
      "S",
      "H",
      "A",
      "C",
      "V",
      "X",
      "Z",
      "Y",
      "Plus",
      "Minus",
      "Equal",
      "0",
      "BracketLeft",
      "BracketRight",
    ].includes(key)
  )
    return true;
  return (
    parts.includes("Alt") && ["ArrowLeft", "ArrowRight", "F4"].includes(key)
  );
}
export function validateShortcutBindings(
  overrides: ShortcutBindings,
  mac = false,
): { action: ShortcutAction; message: string }[] {
  const issues: { action: ShortcutAction; message: string }[] = [];
  const effective = effectiveBindings(overrides);
  for (const definition of shortcutDefinitions) {
    const seen = new Set<string>();
    for (const chord of effective[definition.id]) {
      if (normalizeShortcut(chord) !== chord)
        issues.push({
          action: definition.id,
          message: `Invalid shortcut: ${chord}`,
        });
      else if (reserved(chord, definition.id))
        issues.push({
          action: definition.id,
          message: `${formatShortcut(chord, mac)} is reserved for standard keyboard or browser behavior.`,
        });
      else if (seen.has(chord))
        issues.push({
          action: definition.id,
          message: `This shortcut is already assigned to ${definition.label.toLowerCase()}.`,
        });
      seen.add(chord);
      for (const other of shortcutDefinitions) {
        if (
          other.id === definition.id ||
          (other.scope !== definition.scope &&
            other.scope !== "global" &&
            definition.scope !== "global")
        )
          continue;
        if (
          effective[other.id].some((candidate) =>
            [false, true].some(
              (mac) =>
                physicalChord(candidate, mac) === physicalChord(chord, mac),
            ),
          )
        ) {
          issues.push({
            action: definition.id,
            message: `${formatShortcut(chord, mac)} is already used by ${other.label.toLowerCase()}.`,
          });
        }
      }
    }
  }
  return issues;
}
export const shortcutBindingsSchema = z
  .partialRecord(shortcutActionSchema, z.array(z.string().max(40)).max(3))
  .superRefine((bindings, context) => {
    for (const issue of validateShortcutBindings(bindings))
      context.addIssue({
        code: "custom",
        path: [issue.action],
        message: issue.message,
      });
  });
