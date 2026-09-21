import { matchesShortcut, type ShortcutBindings } from "@nerilo/protocol";
export type AppShortcut =
  | "search"
  | "new-task"
  | "sidebar"
  | "settings"
  | "help"
  | "composer"
  | "next-region"
  | "previous-region";
type Key = Pick<
  KeyboardEvent,
  | "key"
  | "metaKey"
  | "ctrlKey"
  | "altKey"
  | "shiftKey"
  | "repeat"
  | "isComposing"
  | "defaultPrevented"
>;
const actions: AppShortcut[] = [
  "search",
  "new-task",
  "sidebar",
  "settings",
  "help",
  "composer",
  "next-region",
  "previous-region",
];
export function appShortcut(
  event: Key,
  context: { editing: boolean; overlay: boolean; mac: boolean },
  bindings: ShortcutBindings = {},
): AppShortcut | null {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    context.overlay
  )
    return null;
  for (const action of actions) {
    if (context.editing) {
      if (
        !["search", "new-task", "next-region", "previous-region"].includes(
          action,
        )
      )
        continue;
      // Rebinding a global command to a character must never consume typing.
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !/^F\d{1,2}$/i.test(event.key)
      )
        continue;
    }
    if (matchesShortcut(event, action, bindings, context.mac)) return action;
  }
  return null;
}

export function isEditing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"]',
      ),
    )
  );
}

export function visible(element: Element) {
  return (
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== "hidden" &&
    !element.closest('[inert], [hidden], [aria-hidden="true"]')
  );
}

export function openKeyboardLayer() {
  return [
    ...document.querySelectorAll(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open], [data-shortcut-recording="true"]',
    ),
  ].some(visible);
}

export function focusComposer() {
  const input = document.querySelector<HTMLElement>(
    'main [data-keyboard-region="composer"] :is(textarea, [contenteditable="true"])',
  );
  if (
    !input ||
    input.matches(':disabled, [aria-disabled="true"]') ||
    !visible(input)
  )
    return false;
  input.focus();
  return true;
}

export function focusRegion(region: HTMLElement) {
  if (region.dataset.keyboardRegion === "composer" && focusComposer()) return;
  if (region.dataset.keyboardRegion === "navigation") {
    const target =
      region.querySelector<HTMLElement>('[aria-current="page"]') ??
      region.querySelector<HTMLElement>(".workspace-toggle") ??
      region.querySelector<HTMLElement>("button");
    if (target && visible(target)) {
      target.focus();
      return;
    }
  }
  region.focus();
}

export function cycleRegion(backward: boolean) {
  const regions = [
    ...document.querySelectorAll<HTMLElement>("[data-keyboard-region]"),
  ].filter(visible);
  const current = document.activeElement?.closest("[data-keyboard-region]");
  const index = regions.findIndex((region) => region === current);
  const next =
    regions[
      index < 0
        ? backward
          ? regions.length - 1
          : 0
        : (index + (backward ? -1 : 1) + regions.length) % regions.length
    ];
  if (next) focusRegion(next);
}
