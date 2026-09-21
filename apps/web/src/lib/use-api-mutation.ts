"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commandOptions } from "@/lib/mutation-options";
import { useSession } from "@/lib/query-provider";

export function useApiMutation(scope?: string) {
  const { machineId } = useSession();
  const client = useQueryClient();
  return useMutation(commandOptions(client, machineId, scope));
}
