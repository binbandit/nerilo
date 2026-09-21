"use client";
import { useStoredString } from "@/lib/use-stored-string";

export function useDraft(key: string) {
  return useStoredString(`nerilo-draft:${key}`);
}
