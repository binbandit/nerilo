"use client";
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ShortcutBindings } from "@nerilo/protocol";
const KeyboardPreferences = createContext<ShortcutBindings>({});
export function KeyboardPreferencesProvider({
  bindings,
  children,
}: {
  bindings: ShortcutBindings;
  children: ReactNode;
}) {
  return (
    <KeyboardPreferences.Provider value={bindings}>
      {children}
    </KeyboardPreferences.Provider>
  );
}
export function useKeyboardBindings() {
  return useContext(KeyboardPreferences);
}
const subscribe = () => () => {};
export function useShortcutPlatform() {
  return useSyncExternalStore(
    subscribe,
    () => /Mac|iPhone|iPad/.test(navigator.platform),
    () => false,
  );
}
