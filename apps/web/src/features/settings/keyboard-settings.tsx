"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, RotateCcw, X } from "lucide-react";
import {
  effectiveBindings,
  formatShortcut,
  shortcutDefinitions,
  shortcutFromEvent,
  validateShortcutBindings,
  type ShortcutAction,
  type ShortcutBindings,
} from "@nerilo/protocol";
import { useShortcutPlatform } from "@/features/navigation/shortcut-preferences";
import { Button } from "@/components/ui/ui";
import "@/features/settings/keyboard-settings.css";

export function KeyboardSettings({
  bindings,
  busy,
  save,
}: {
  bindings: ShortcutBindings;
  busy: boolean;
  save: (bindings: ShortcutBindings) => Promise<boolean>;
}) {
  const mac = useShortcutPlatform();
  const [recording, setRecording] = useState<{
    action: ShortcutAction;
    index: number;
  } | null>(null);
  const [issue, setIssue] = useState<{
    action?: ShortcutAction;
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const rowRefs = useRef(new Map<ShortcutAction, HTMLDivElement>());
  const recordButton = useRef<HTMLButtonElement>(null);
  const inFlight = useRef(false);
  const returnFocus = useRef<ShortcutAction | null>(null);
  const effective = effectiveBindings(bindings);
  useEffect(() => {
    if (busy || saving) return;
    if (recording) recordButton.current?.focus();
    else if (returnFocus.current) {
      rowRefs.current
        .get(returnFocus.current)
        ?.querySelector<HTMLButtonElement>("button")
        ?.focus();
      returnFocus.current = null;
    }
  }, [recording, busy, saving]);
  function stopRecording() {
    if (recording) returnFocus.current = recording.action;
    setRecording(null);
  }
  async function update(next: ShortcutBindings, action?: ShortcutAction) {
    if (busy || inFlight.current) return;
    const validation = validateShortcutBindings(next, mac);
    const problem =
      validation.find((item) => item.action === action) ?? validation[0];
    if (problem) {
      setIssue({ action, message: problem.message });
      return;
    }
    inFlight.current = true;
    setSaving(true);
    setIssue(null);
    setNotice("");
    try {
      if (await save(next)) {
        returnFocus.current = action ?? recording?.action ?? "search";
        stopRecording();
        setNotice("Shortcuts saved.");
      } else
        setIssue({
          action,
          message:
            "Could not save shortcuts. Your previous bindings are still active.",
        });
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }
  const locked = busy || saving;
  return (
    <>
      <header className="preferences-heading keyboard-settings-heading">
        <div>
          <h2>Keyboard</h2>
          <p>Select a shortcut to change it.</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          label="Reset all"
          icon={<RotateCcw size={13} />}
          isDisabled={locked || !Object.keys(bindings).length}
          onClick={() => void update({})}
        />
      </header>
      {["Workspace", "Lists", "Writing"].map((group) => (
        <section
          className="keyboard-settings-group"
          key={group}
          aria-label={group + " shortcuts"}
        >
          <h3>{group}</h3>
          {shortcutDefinitions
            .filter((item) => item.group === group)
            .map(({ id, label }) => (
              <div
                className="keyboard-settings-item"
                key={id}
                ref={(element) => {
                  if (element) rowRefs.current.set(id, element);
                  else rowRefs.current.delete(id);
                }}
              >
                <div className="keyboard-settings-row">
                  <span className="keyboard-settings-label">{label}</span>
                  <div className="keyboard-settings-bindings">
                    {effective[id].map((chord, index) => (
                      <button
                        type="button"
                        className="keyboard-settings-chord"
                        key={index}
                        disabled={locked}
                        aria-label={`Change ${label.toLowerCase()}: ${formatShortcut(chord, mac)}`}
                        onClick={() => {
                          setRecording({ action: id, index });
                          setIssue(null);
                        }}
                      >
                        <kbd>{formatShortcut(chord, mac)}</kbd>
                      </button>
                    ))}
                    {!effective[id].length && (
                      <span className="keyboard-settings-disabled">Off</span>
                    )}
                    {effective[id].length < 3 && (
                      <button
                        type="button"
                        className="keyboard-settings-action"
                        disabled={locked}
                        aria-label={`Add shortcut for ${label.toLowerCase()}`}
                        title="Add shortcut"
                        onClick={() => {
                          setRecording({
                            action: id,
                            index: effective[id].length,
                          });
                          setIssue(null);
                        }}
                      >
                        <Plus size={13} />
                      </button>
                    )}
                    {effective[id].length > 0 && (
                      <button
                        type="button"
                        className="keyboard-settings-action"
                        disabled={locked}
                        aria-label={`Disable ${label.toLowerCase()} shortcut`}
                        title="Disable"
                        onClick={() =>
                          void update({ ...bindings, [id]: [] }, id)
                        }
                      >
                        <X size={13} />
                      </button>
                    )}
                    {bindings[id] !== undefined && (
                      <button
                        type="button"
                        className="keyboard-settings-action"
                        disabled={locked}
                        aria-label={`Reset ${label.toLowerCase()} shortcut`}
                        title="Reset"
                        onClick={() => {
                          const next = { ...bindings };
                          delete next[id];
                          void update(next, id);
                        }}
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                  </div>
                </div>
                {recording?.action === id && (
                  <div
                    className="keyboard-settings-recorder"
                    data-shortcut-recording="true"
                  >
                    <button
                      type="button"
                      ref={recordButton}
                      className="keyboard-settings-record"
                      disabled={locked}
                      aria-label={`Record shortcut for ${label.toLowerCase()}`}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === "Tab") {
                          setRecording(null);
                          return;
                        }
                        event.preventDefault();
                        if (event.key === "Escape") {
                          stopRecording();
                          return;
                        }
                        if (event.repeat || locked) return;
                        const chord = shortcutFromEvent(event, mac);
                        if (!chord) return;
                        const next = [...effective[id]];
                        next[recording.index] = chord;
                        void update({ ...bindings, [id]: next }, id);
                      }}
                    >
                      Press a shortcut…
                    </button>
                    <button
                      type="button"
                      className="keyboard-settings-action"
                      disabled={locked}
                      onClick={stopRecording}
                    >
                      Cancel
                    </button>
                    {recording.index < effective[id].length && (
                      <button
                        type="button"
                        className="keyboard-settings-action"
                        disabled={locked}
                        onClick={() =>
                          void update(
                            {
                              ...bindings,
                              [id]: effective[id].filter(
                                (_, index) => index !== recording.index,
                              ),
                            },
                            id,
                          )
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                )}
                {issue?.action === id && (
                  <p className="keyboard-settings-error" role="alert">
                    {issue.message}
                  </p>
                )}
              </div>
            ))}
        </section>
      ))}
      {issue && !issue.action && (
        <p className="keyboard-settings-error" role="alert">
          {issue.message}
        </p>
      )}
      <p className="preferences-footnote">
        Tab moves between controls. Enter and Space activate focused buttons.
        Escape closes menus and dialogs. These standard controls stay available.
      </p>
      <span className="keyboard-settings-notice" role="status">
        {notice}
      </span>
    </>
  );
}
