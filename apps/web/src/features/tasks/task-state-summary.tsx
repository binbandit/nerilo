"use client";
import { useQuery } from "@tanstack/react-query";
import type { Task } from "@nerilo/protocol";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import "@/features/tasks/task-state-summary.css";

export function TaskStateSummary({
  taskId,
  turnId,
  status,
}: {
  taskId: string;
  turnId: string | undefined;
  status: Task["status"];
}) {
  const { machineId, ready } = useSession();
  const { data: summary } = useQuery({
    ...queries.summary(machineId, taskId, turnId ?? "", status),
    enabled: ready && Boolean(turnId),
  });
  if (!summary?.text || summary.turnId !== turnId) return null;
  return <p className="task-state-summary">{summary.text}</p>;
}
