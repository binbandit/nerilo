import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultShortcutBindings,
  effectiveBindings,
  matchesShortcut,
  normalizeShortcut,
  shortcutBindingsSchema,
  shortcutFromEvent,
  validateShortcutBindings,
  type ShortcutKey,
} from "@nerilo/protocol";
import { Store } from "./store";
import { Engine } from "./engine";
import { createApi } from "./api";
const key = (key: string, extra: Partial<ShortcutKey> = {}): ShortcutKey => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...extra,
});

test("shortcut registry resolves platform modifiers, symbols, disabled bindings and composition", () => {
  expect(validateShortcutBindings({})).toEqual([]);
  expect(normalizeShortcut("shift+mod+k")).toBe("Mod+Shift+K");
  expect(normalizeShortcut("Mod+Ctrl+K")).toBeNull();
  expect(shortcutFromEvent(key("?", { shiftKey: true }))).toBe("?");
  expect(
    shortcutFromEvent(key("π", { code: "KeyP", altKey: true }), true),
  ).toBe("Alt+P");
  expect(matchesShortcut(key("k", { metaKey: true }), "search", {}, true)).toBe(
    true,
  );
  expect(
    matchesShortcut(key("k", { ctrlKey: true }), "search", {}, false),
  ).toBe(true);
  expect(matchesShortcut(key("k", { ctrlKey: true }), "search", {}, true)).toBe(
    false,
  );
  expect(
    matchesShortcut(
      key("k", { metaKey: true, shiftKey: true }),
      "search",
      {},
      true,
    ),
  ).toBe(false);
  expect(
    matchesShortcut(
      key("k", { metaKey: true, nativeEvent: { isComposing: true } }),
      "search",
      {},
      true,
    ),
  ).toBe(false);
  expect(
    matchesShortcut(
      key("k", { metaKey: true, defaultPrevented: true }),
      "search",
      {},
      true,
    ),
  ).toBe(false);
  expect(
    matchesShortcut(
      key("k", { metaKey: true }),
      "search",
      { search: [] },
      true,
    ),
  ).toBe(false);
  expect(effectiveBindings({ search: [] })["send-message"]).toEqual(
    defaultShortcutBindings["send-message"],
  );
});

test("shortcut validation rejects conflicting and reserved assignments without blocking independent form scopes", () => {
  expect(shortcutBindingsSchema.safeParse({ search: ["Mod+J"] }).success).toBe(
    false,
  );
  expect(shortcutBindingsSchema.safeParse({ search: ["Ctrl+J"] }).success).toBe(
    false,
  );
  expect(shortcutBindingsSchema.safeParse({ search: ["Mod+F"] }).success).toBe(
    false,
  );
  expect(shortcutBindingsSchema.safeParse({ search: ["Tab"] }).success).toBe(
    false,
  );
  expect(shortcutBindingsSchema.safeParse({ search: ["Escape"] }).success).toBe(
    false,
  );
  expect(
    shortcutBindingsSchema.safeParse({ "send-message": ["A"] }).success,
  ).toBe(false);
  expect(shortcutBindingsSchema.safeParse({ surprise: ["F6"] }).success).toBe(
    false,
  );
  expect(
    shortcutBindingsSchema.safeParse({
      search: ["Mod+Shift+K"],
      "send-message": ["Mod+Enter"],
    }).success,
  ).toBe(true);
});

test("shortcut preferences persist, reject invalid writes and survive unrelated settings updates", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-keyboard-"));
  const path = join(directory, "store.sqlite");
  let store = new Store(path);
  const api = createApi(store, new Engine(store, true), "test");
  const post = (body: unknown, authorization = "Bearer test") =>
    api(
      new Request("http://localhost/settings", {
        method: "POST",
        headers: { Authorization: authorization },
        body: JSON.stringify(body),
      }),
    );
  try {
    expect(store.get("settings", "default")?.keybindings).toEqual({});
    expect(
      (await post({ keybindings: { search: ["Mod+Shift+K"], sidebar: [] } }))
        .status,
    ).toBe(200);
    expect((await post({ appearance: "dark" })).status).toBe(200);
    expect((await post({ keybindings: { search: ["Mod+J"] } })).status).toBe(
      400,
    );
    expect((await post({ keybindings: {} }, "Bearer wrong")).status).toBe(401);
    store.db.close();
    store = new Store(path);
    expect(store.get("settings", "default")?.keybindings).toEqual({
      search: ["Mod+Shift+K"],
      sidebar: [],
    });
    expect(store.get("settings", "default")?.appearance).toBe("dark");
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
