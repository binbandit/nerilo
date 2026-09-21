"use client";

import { useCallback, useSyncExternalStore } from "react";
import { machineStorageKey } from "@/features/machines/machine-location";

const changes = new EventTarget();
const unsaved = new Map<string, string>();
const serverSnapshot = () => "";

export function useStoredString(key: string) {
  const storageKey = machineStorageKey(
    key,
    typeof window === "undefined" ? "" : window.location.search,
  );
  const subscribe = useCallback(
    (notify: () => void) => {
      const onStorage = (event: StorageEvent) => {
        if (event.key === null || event.key === storageKey) {
          unsaved.delete(storageKey);
          notify();
        }
      };
      changes.addEventListener(storageKey, notify);
      window.addEventListener("storage", onStorage);
      return () => {
        changes.removeEventListener(storageKey, notify);
        window.removeEventListener("storage", onStorage);
      };
    },
    [storageKey],
  );
  const snapshot = useCallback(() => {
    if (unsaved.has(storageKey)) return unsaved.get(storageKey)!;
    try {
      return localStorage.getItem(storageKey) ?? "";
    } catch {
      return "";
    }
  }, [storageKey]);
  const value = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const update = useCallback(
    (next: string) => {
      try {
        if (next) localStorage.setItem(storageKey, next);
        else localStorage.removeItem(storageKey);
        unsaved.delete(storageKey);
      } catch {
        // Keep editing usable when browser storage is unavailable or full.
        unsaved.set(storageKey, next);
      }
      changes.dispatchEvent(new Event(storageKey));
    },
    [storageKey],
  );
  return [value, update] as const;
}
