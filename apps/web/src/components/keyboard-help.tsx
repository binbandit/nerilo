"use client";
import {
  effectiveBindings,
  formatShortcut,
  shortcutDefinitions,
} from "@nerilo/protocol";
import { Modal } from "@/components/editors";
import { useKeyboardBindings } from "@/lib/shortcut-preferences";

export function KeyboardHelp({
  onClose,
  mac,
}: {
  onClose: () => void;
  mac: boolean;
}) {
  const bindings = effectiveBindings(useKeyboardBindings());
  return (
    <Modal title="Keyboard shortcuts" width={540} onClose={onClose}>
      <div className="keyboard-guide">
        {["Workspace", "Lists", "Writing"].map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <dl>
              {shortcutDefinitions
                .filter((item) => item.group === group)
                .map(({ id, label }) => (
                  <div key={id}>
                    <dt>{label}</dt>
                    <dd>
                      {bindings[id].length
                        ? bindings[id].map((chord) => (
                            <kbd key={chord}>{formatShortcut(chord, mac)}</kbd>
                          ))
                        : "Unassigned"}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
        ))}
        <p>
          Change bindings in Settings → Keyboard. Tab moves between controls;
          Enter or Space activates them. Escape closes menus and dialogs. Shift
          Enter adds a new line.
        </p>
        <p>
          Workspace shortcuts pause while a menu or dialog is open. Character
          shortcuts stay out of your way while typing.
        </p>
      </div>
    </Modal>
  );
}
