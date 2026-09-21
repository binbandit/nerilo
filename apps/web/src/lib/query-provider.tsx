"use client";

import {
  createContext,
  useCallback,
  useMemo,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiUrl } from "@/lib/api";
import {
  bootstrapQuery,
  createQueryClient,
  queryKeys,
} from "@/lib/query-options";
import { selectedMachine } from "@/features/machines/machine-location";

const subscribe = () => () => {};
const browserMachine = () => selectedMachine(window.location.search);
const serverMachine = () => null;
const Session = createContext<{
  machineId: string;
  ready: boolean;
  attempted: boolean;
  error: Error | null;
  reconnect: () => Promise<void>;
} | null>(null);

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <MachineSession>{children}</MachineSession>
    </QueryClientProvider>
  );
}

function MachineSession({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const selection = useSyncExternalStore(
    subscribe,
    browserMachine,
    serverMachine,
  );
  const machineId = selection ?? "local";
  const session = useQuery({
    ...bootstrapQuery(client, machineId),
    enabled: selection !== null,
  });
  const ready = session.data === true;
  useEffect(() => {
    if (!ready) return;
    const snapshot = client.getQueryData<{ sequence: number }>(
      queryKeys.snapshot(machineId),
    );
    const source = new EventSource(
      apiUrl(`events?after=${snapshot?.sequence ?? 0}`, machineId),
    );
    // The daemon currently emits a coarse sequence. Keep reconciliation polling
    // for settings/runtime changes that do not advance that sequence.
    const refresh = () => {
      void client.invalidateQueries(
        { queryKey: queryKeys.machine(machineId) },
        { cancelRefetch: false },
      );
    };
    source.addEventListener("change", refresh);
    source.addEventListener("open", refresh);
    return () => source.close();
  }, [client, machineId, ready]);

  const { refetch, isFetched, error } = session;
  const reconnect = useCallback(async () => {
    await client.cancelQueries({ queryKey: queryKeys.machine(machineId) });
    await refetch();
    await client.invalidateQueries({ queryKey: queryKeys.machine(machineId) });
    await client.invalidateQueries({ queryKey: queryKeys.registry });
  }, [client, machineId, refetch]);
  const value = useMemo(
    () => ({ machineId, ready, attempted: isFetched, error, reconnect }),
    [machineId, ready, isFetched, error, reconnect],
  );
  return <Session value={value}>{children}</Session>;
}

export function useSession() {
  const session = useContext(Session);
  if (!session) throw new Error("Daemon queries require QueryProvider.");
  return session;
}
