"use client";
import { useEffect, useState } from "react";
import { machineStorageKey } from "./machine-location";

export function useDraft(key: string) {
  const storageKey = machineStorageKey(
    `nerilo-draft:${key}`,
    typeof window === "undefined" ? "" : window.location.search,
  );
  const [value, setValue] = useState("");
  useEffect(() => {
    try {
      setValue(localStorage.getItem(storageKey) ?? "");
    } catch {}
  }, [storageKey]);
  const update = (next: string) => {
    setValue(next);
    try {
      if (next) localStorage.setItem(storageKey, next);
      else localStorage.removeItem(storageKey);
    } catch {}
  };
  return [value, update] as const;
}
