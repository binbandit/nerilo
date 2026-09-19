"use client";
import { ChatComposer, type ChatComposerProps } from "@astryxdesign/core";
import { matchesShortcut } from "@nerilo/protocol";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/lib/shortcut-preferences";
import { openKeyboardLayer } from "@/lib/keyboard";

export function MessageComposer(props: ChatComposerProps) {
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  return (
    <ChatComposer
      {...props}
      onKeyDownCapture={(event) => {
        if (
          event.defaultPrevented ||
          event.nativeEvent.isComposing ||
          event.nativeEvent.keyCode === 229
        )
          return;
        const target = event.target;
        if (
          !(target instanceof HTMLElement) ||
          !target.closest('textarea, [contenteditable="true"]') ||
          openKeyboardLayer()
        )
          return;
        const send = matchesShortcut(event, "send-message", bindings, mac);
        if (send) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat && !props.isDisabled && props.value?.trim())
            props.onSubmit(props.value.trim());
        } else if (event.key === "Enter" && !event.shiftKey) {
          // Astryx serializes BR nodes, but the browser's insertParagraph creates DIVs.
          // insertLineBreak preserves selection, input events, and native undo.
          event.stopPropagation();
          event.preventDefault();
          if (!event.metaKey && !event.ctrlKey && !event.altKey)
            document.execCommand("insertLineBreak");
        }
      }}
    />
  );
}
