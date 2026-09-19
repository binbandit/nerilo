"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuDivider,
} from "@astryxdesign/core/DropdownMenu";
import { CalendarClock, Clock3, Sunrise, X } from "lucide-react";
import { Button } from "@/components/ui";
import { Modal } from "@/components/editors";
import "./compact-picker.css";
import "./schedule-picker.css";
import "./task-queue.css";

export function scheduledTime(value: string) {
  const date = new Date(value);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const day =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === tomorrow.toDateString()
        ? "Tomorrow"
        : date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            ...(date.getFullYear() !== today.getFullYear()
              ? { year: "numeric" }
              : {}),
          });
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
}

function localDateTime(value: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 3600000);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function SchedulePicker({
  value,
  onChange,
  disabled = false,
  compact = false,
  label = "Schedule message",
}: {
  value: string | null;
  onChange: (value: string | null) => void | Promise<void>;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const saving = useRef(false);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState("");
  const [openedAt, setOpenedAt] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!custom) return;
    const frame = requestAnimationFrame(() => dateRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [custom]);
  const validTime =
    Number.isFinite(new Date(draft).getTime()) &&
    new Date(draft).getTime() > Date.now();
  const inAnHour = new Date(openedAt + 3600000);
  const tomorrow = new Date(openedAt);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  const clockTime = (date: Date) =>
    date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  function closeCustom() {
    if (saving.current) return;
    setCustom(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }
  async function choose(next: string | null) {
    if (saving.current || disabled) return;
    if (
      next &&
      (!Number.isFinite(Date.parse(next)) || Date.parse(next) <= Date.now())
    ) {
      setError("Choose a future time.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      await onChange(next);
      setOpen(false);
      setCustom(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not schedule this message.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const setCustomTime = () => {
    if (validTime) void choose(new Date(draft).toISOString());
    else setError("Choose a future time.");
  };
  return (
    <span
      className="schedule-picker"
      onClick={(event) => event.stopPropagation()}
    >
      <DropdownMenu
        placement="above"
        alignment="end"
        menuWidth={248}
        hasChevron={false}
        isMenuOpen={open}
        onOpenChange={(next) => {
          if (saving.current) return;
          if (next) {
            setOpenedAt(Date.now());
            setError("");
          }
          setOpen(next);
        }}
        button={{
          ref: triggerRef,
          label: value ? scheduledTime(value) : label,
          "aria-label": value ? `${label}: ${scheduledTime(value)}` : label,
          icon: <CalendarClock size={14} />,
          isIconOnly: compact || !value,
          isDisabled: disabled || busy,
          variant: "ghost",
          size: "sm",
          className: `queue-schedule-trigger ${value ? "scheduled" : ""} ${compact ? "compact" : ""}`,
        }}
      >
        <DropdownMenuItem
          className="compact-picker-option"
          label="In an hour"
          icon={<Clock3 size={14} />}
          endContent={
            <span className="compact-picker-meta">{clockTime(inAnHour)}</span>
          }
          isDisabled={busy}
          hasCloseOnSelect={false}
          onClick={() => void choose(inAnHour.toISOString())}
        />
        <DropdownMenuItem
          className="compact-picker-option"
          label="Tomorrow morning"
          icon={<Sunrise size={14} />}
          endContent={
            <span className="compact-picker-meta">{clockTime(tomorrow)}</span>
          }
          isDisabled={busy}
          hasCloseOnSelect={false}
          onClick={() => void choose(tomorrow.toISOString())}
        />
        <DropdownMenuDivider />
        <DropdownMenuItem
          className="compact-picker-option"
          label="Choose date and time…"
          icon={<CalendarClock size={14} />}
          isDisabled={busy}
          onClick={() => {
            setDraft(localDateTime(value));
            setError("");
            setOpen(false);
            setCustom(true);
          }}
        />
        {value && (
          <DropdownMenuItem
            className="compact-picker-option"
            label="Remove schedule"
            icon={<X size={14} />}
            isDisabled={busy}
            hasCloseOnSelect={false}
            onClick={() => void choose(null)}
          />
        )}
        {error && !custom && (
          <p className="schedule-error" role="alert">
            {error}
          </p>
        )}
      </DropdownMenu>
      {custom && (
        <Modal
          title="Schedule message"
          width={360}
          onClose={closeCustom}
          onSubmit={setCustomTime}
          footer={
            <>
              <Button
                label="Cancel"
                variant="ghost"
                size="sm"
                isDisabled={busy}
                onClick={closeCustom}
              />
              <Button
                label="Set time"
                variant="primary"
                size="sm"
                isLoading={busy}
                isDisabled={busy || !validTime}
                onClick={setCustomTime}
              />
            </>
          }
        >
          <div className="schedule-date-fields">
            <label htmlFor={`${id}-date`}>
              Date
              <input
                id={`${id}-date`}
                type="date"
                ref={dateRef}
                value={draft.split("T")[0] ?? ""}
                min={localDateTime(new Date().toISOString()).split("T")[0]}
                disabled={busy}
                onChange={(event) =>
                  setDraft(
                    `${event.target.value}T${draft.split("T")[1] ?? "09:00"}`,
                  )
                }
              />
            </label>
            <label htmlFor={`${id}-time`}>
              Time
              <input
                id={`${id}-time`}
                type="time"
                value={draft.split("T")[1] ?? ""}
                disabled={busy}
                onChange={(event) =>
                  setDraft(`${draft.split("T")[0]}T${event.target.value}`)
                }
              />
            </label>
          </div>
          <p className="schedule-timezone">
            {Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone.replaceAll("_", " ")}
          </p>
          {error && (
            <p className="schedule-error" role="alert">
              {error}
            </p>
          )}
        </Modal>
      )}
    </span>
  );
}
