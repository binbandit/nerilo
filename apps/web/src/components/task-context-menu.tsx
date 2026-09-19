"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ContextMenu } from "@astryxdesign/core";
import { useToast } from "@astryxdesign/core/Toast";
import { Archive, ArchiveRestore, Trash2 } from "lucide-react";
import { activeStatuses, matchesShortcut, type Task } from "@nerilo/protocol";
import { Modal } from "@/components/editors";
import { Button } from "@/components/ui";
import { mutate } from "@/lib/api";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/lib/shortcut-preferences";

export function TaskContextMenu({
  task,
  children,
  refresh,
  onDeleted,
  onRemoved,
}: {
  task: Task;
  children: ReactNode;
  refresh: () => void;
  onDeleted: () => void;
  onRemoved?: () => void;
}) {
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const trigger = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = trigger.current;
    if (!element) return;
    const openFromKeyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      const configured = matchesShortcut(event, "context-menu", bindings, mac);
      if (!configured) {
        // Prevent the browser from reintroducing the old keyboard binding.
        // Pointer context menus still use Astryx's normal event handler.
        if (
          event.key === "ContextMenu" ||
          (event.shiftKey && event.key === "F10")
        ) {
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        target.closest('input,textarea,[contenteditable="true"]')
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 0,
          clientY: 0,
          detail: 0,
        }),
      );
    };
    element.addEventListener("keydown", openFromKeyboard);
    return () => element.removeEventListener("keydown", openFromKeyboard);
  }, [bindings, mac]);
  const closeDialog = () => {
    if (working.current) return;
    setConfirm(false);
    setError("");
    requestAnimationFrame(() =>
      trigger.current?.querySelector<HTMLElement>("a[href],button")?.focus(),
    );
  };
  const running =
    Boolean(task.activeTurnId) || activeStatuses.includes(task.status);
  async function act(action: "archive" | "delete") {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await mutate(
        `tasks/${task.id}/${action}`,
        action === "archive" ? { archived: !task.archived } : {},
      );
      setConfirm(false);
      if (action === "delete" || !task.archived) onRemoved?.();
      if (action === "delete") onDeleted();
      refresh();
    } catch (reason) {
      const message =
        reason instanceof Error ? reason.message : "Could not update the task.";
      setError(message);
      toast({
        type: "error",
        uniqueID: `task-action-${task.id}`,
        body:
          action === "delete"
            ? `Deletion did not finish. Check the archived task before retrying. ${message}`
            : message,
      });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <ContextMenu
        ref={trigger}
        label={`Actions for ${task.title}`}
        menuWidth={180}
        items={[
          {
            label: task.archived ? "Restore" : "Archive",
            icon: task.archived ? (
              <ArchiveRestore size={15} />
            ) : (
              <Archive size={15} />
            ),
            isDisabled: running || busy,
            onClick: () => void act("archive"),
          },
          { type: "divider" },
          {
            label: "Delete…",
            icon: <Trash2 size={15} />,
            isDisabled: running || busy,
            onClick: () => {
              setError("");
              setConfirm(true);
            },
          },
        ]}
      >
        {children}
      </ContextMenu>
      {(confirm || error) && (
        <Modal
          title={confirm ? "Delete task?" : "Task actions"}
          width={420}
          onClose={closeDialog}
          footer={
            <>
              <Button
                variant="ghost"
                label="Cancel"
                isDisabled={busy}
                onClick={closeDialog}
              />
              {confirm && (
                <Button
                  label="Delete task"
                  isLoading={busy}
                  isDisabled={busy}
                  onClick={() => void act("delete")}
                />
              )}
            </>
          }
        >
          {confirm && (
            <p>
              <strong>{task.title}</strong> and its sandbox files will be
              permanently deleted. Exported local checkouts will be kept.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </>
  );
}
