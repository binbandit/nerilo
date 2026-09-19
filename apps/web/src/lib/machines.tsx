"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { machinesSchema, type Machine } from "@nerilo/protocol";
import { read } from "@/lib/api";

type MachinesContextValue = {
  machines: Machine[];
  currentId: string;
  current: Machine | undefined;
  error: string;
  loading: boolean;
  refresh: () => Promise<void>;
  switchMachine: (id: string) => void;
};
const MachinesContext = createContext<MachinesContextValue | null>(null);
export function MachineProvider({ children }: { children: ReactNode }) {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [currentId, setCurrentId] = useState("local");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const lifecycle = useRef(0);
  const mounted = useRef(false);
  const received = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async () => {
    const generation = lifecycle.current;
    const previous = pending.current;
    const next = (async () => {
      await previous;
      if (!mounted.current || generation !== lifecycle.current) return;
      try {
        const result = machinesSchema.parse(await read("machines"));
        if (!mounted.current || generation !== lifecycle.current) return;
        received.current = true;
        setMachines(result.machines);
        setError("");
      } catch (reason) {
        if (!mounted.current || generation !== lifecycle.current) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Machines could not be loaded.",
        );
      } finally {
        if (mounted.current && generation === lifecycle.current)
          setLoading(false);
      }
    })();
    pending.current = next;
    await next;
    if (pending.current === next) pending.current = null;
  }, []);
  useEffect(() => {
    mounted.current = true;
    setCurrentId(
      new URL(window.location.href).searchParams.get("machine") || "local",
    );
    void refresh();
    const retryTimers = [500, 2_000, 4_000].map((delay) =>
      window.setTimeout(() => {
        if (!received.current) void refresh();
      }, delay),
    );
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => {
      clearInterval(timer);
      retryTimers.forEach(clearTimeout);
      mounted.current = false;
      lifecycle.current++;
    };
  }, [refresh]);
  const switchMachine = useCallback((id: string) => {
    const url = new URL(window.location.href);
    if (id === "local") url.searchParams.delete("machine");
    else url.searchParams.set("machine", id);
    url.hash = "home";
    window.location.assign(url.toString());
  }, []);
  return (
    <MachinesContext.Provider
      value={{
        machines,
        currentId,
        current: machines.find((machine) => machine.id === currentId),
        error,
        loading,
        refresh,
        switchMachine,
      }}
    >
      {children}
    </MachinesContext.Provider>
  );
}
export function useMachines() {
  const value = useContext(MachinesContext);
  if (!value) throw new Error("Machine controls require MachineProvider.");
  return value;
}
