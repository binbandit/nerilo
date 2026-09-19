"use client";
import { useEffect, useState } from "react";
import { read } from "@/lib/api";
import "./task-state-summary.css";

export function TaskStateSummary({
  taskId,
  turnId,
  revision,
}: {
  taskId: string;
  turnId: string | undefined;
  revision: number;
}) {
  const [summary, setSummary] = useState<{
    taskId: string;
    turnId: string;
    text: string;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    void read(`tasks/${taskId}/state-summary`)
      .then((value) => {
        if (disposed) return;
        if (
          !value ||
          typeof value !== "object" ||
          !("text" in value) ||
          typeof value.text !== "string" ||
          !("turnId" in value) ||
          typeof value.turnId !== "string"
        ) {
          setSummary(null);
          return;
        }
        setSummary({ taskId, turnId: value.turnId, text: value.text });
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, [taskId, turnId, revision]);
  if (!summary || summary.taskId !== taskId || summary.turnId !== turnId)
    return null;
  return <p className="task-state-summary">{summary.text}</p>;
}
