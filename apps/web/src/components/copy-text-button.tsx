"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Copy, AlertCircle } from "lucide-react";
import "./copy-text-button.css";

export function CopyTextButton({
  text,
  label,
}: {
  text: string;
  label: string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const pending = useRef(false);
  useEffect(() => {
    if (status === "idle") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);
  const feedback =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Could not copy. Try again."
        : "";
  return (
    <span className="message-copy-control">
      <button
        type="button"
        className="message-copy-button"
        aria-label={label}
        title={feedback || label}
        onClick={async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (pending.current) return;
          pending.current = true;
          setStatus("idle");
          try {
            await navigator.clipboard.writeText(text);
            setStatus("copied");
          } catch {
            setStatus("failed");
          } finally {
            pending.current = false;
          }
        }}
      >
        {status === "copied" ? (
          <Check size={14} />
        ) : status === "failed" ? (
          <AlertCircle size={14} />
        ) : (
          <Copy size={14} />
        )}
      </button>
      <span className="message-copy-feedback" role="status">
        {feedback}
      </span>
    </span>
  );
}
