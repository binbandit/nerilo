"use client";

import { useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Machine } from "@nerilo/protocol";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";

const emptyMachines: Machine[] = [];

export function useMachines() {
  const { machineId: currentId, attempted } = useSession();
  const { data, error, isPending, refetch } = useQuery({
    ...queries.machines(),
    enabled: attempted,
  });
  const machines = data?.machines ?? emptyMachines;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const switchMachine = useCallback((id: string) => {
    const url = new URL(window.location.href);
    if (id === "local") url.searchParams.delete("machine");
    else url.searchParams.set("machine", id);
    url.hash = "home";
    window.location.assign(url.toString());
  }, []);
  return {
    machines,
    currentId,
    current: machines.find((machine) => machine.id === currentId),
    error: error?.message ?? "",
    loading: isPending,
    refresh,
    switchMachine,
  };
}
