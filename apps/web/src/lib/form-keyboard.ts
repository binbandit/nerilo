import type { KeyboardEvent } from "react";
import { matchesShortcut, type ShortcutBindings } from "@nerilo/protocol";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/lib/shortcut-preferences";

export function useSubmitFromField() {
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  return (event: KeyboardEvent<HTMLElement>, submit: () => void) =>
    submitFromField(event, submit, bindings, mac);
}

export function submitFromField(
  event: KeyboardEvent<HTMLElement>,
  submit: () => void,
  bindings: ShortcutBindings = {},
  mac = false,
) {
  if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing)
    return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || !event.currentTarget.contains(target))
    return;
  // Portaled menus and comboboxes retain their own Enter behavior.
  if (
    target.closest(
      '[role="combobox"], [role="listbox"], [role="menu"], [aria-expanded="true"]',
    )
  )
    return;
  const input =
    target instanceof HTMLInputElement &&
    [
      "text",
      "password",
      "url",
      "email",
      "search",
      "number",
      "datetime-local",
    ].includes(target.type);
  const multiline = target instanceof HTMLTextAreaElement;
  if (!input && !multiline) return;
  if (
    !matchesShortcut(
      event,
      multiline ? "submit-multiline" : "submit-form",
      bindings,
      mac,
    )
  )
    return;
  event.preventDefault();
  submit();
}
