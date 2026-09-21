import { mutationOptions, type QueryClient } from "@tanstack/react-query";
import { mutate } from "@/lib/api";
import { applyMutationResult, mutationKeys } from "@/lib/mutation-cache";

type Command = { path: string; body?: unknown; signal?: AbortSignal };

export function commandOptions(
  client: QueryClient,
  machineId: string,
  scope?: string,
) {
  const cancelReads = (path: string) =>
    Promise.all(
      mutationKeys(machineId, path).map((queryKey) =>
        client.cancelQueries({ queryKey }),
      ),
    );
  return mutationOptions({
    scope: scope ? { id: `${machineId}:${scope}` } : undefined,
    mutationFn: ({ path, body, signal }: Command) =>
      mutate(path, body, signal, machineId),
    onMutate: ({ path }) => cancelReads(path),
    onSuccess: async (result, { path, body }) => {
      // A poll may have started while the command was running. Its older
      // response must not replace the authoritative mutation result.
      await cancelReads(path);
      applyMutationResult(client, machineId, path, result, body);
    },
    onSettled: async (_result, _error, { path }) => {
      // Revalidation errors belong to queries. An accepted command stays
      // successful even when the next read cannot reach the daemon.
      await Promise.all(
        mutationKeys(machineId, path).map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
