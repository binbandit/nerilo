import { expect, test } from "bun:test";
import { appShortcut } from "@/features/navigation/keyboard";

const key = (
  value: string,
  extra: Partial<Parameters<typeof appShortcut>[0]> = {},
) => ({
  key: value,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  defaultPrevented: false,
  ...extra,
});
const context = { editing: false, overlay: false, mac: true };
test("shortcuts use the platform modifier and preserve browser and editor combinations", () => {
  expect(appShortcut(key("k", { metaKey: true }), context)).toBe("search");
  expect(
    appShortcut(key("k", { ctrlKey: true }), { ...context, mac: false }),
  ).toBe("search");
  expect(appShortcut(key("k", { ctrlKey: true }), context)).toBeNull();
  expect(
    appShortcut(key("K", { metaKey: true, shiftKey: true }), context),
  ).toBeNull();
  expect(
    appShortcut(key("b", { metaKey: true }), { ...context, editing: true }),
  ).toBeNull();
  expect(appShortcut(key("/"), { ...context, editing: true })).toBeNull();
  expect(
    appShortcut(key("k", { metaKey: true }), { ...context, editing: true }),
  ).toBe("search");
  for (const value of ["f", "p", "r", "w", "l", "t", "a", "c", "v", "z"])
    expect(appShortcut(key(value, { metaKey: true }), context)).toBeNull();
});
test("open layers, composition, repeated keys and handled events cannot trigger background actions", () => {
  expect(
    appShortcut(key("j", { metaKey: true }), { ...context, overlay: true }),
  ).toBeNull();
  for (const flags of [
    { isComposing: true },
    { repeat: true },
    { defaultPrevented: true },
    { altKey: true },
  ])
    expect(
      appShortcut(key("k", { metaKey: true, ...flags }), context),
    ).toBeNull();
  expect(appShortcut(key("F6", { shiftKey: true }), context)).toBe(
    "previous-region",
  );
  expect(appShortcut(key("?", { shiftKey: true }), context)).toBe("help");
  expect(appShortcut(key("F6"), { ...context, editing: true })).toBe(
    "next-region",
  );
});

test("rebound workspace keys respect editing context and disabled commands", () => {
  const bindings = { search: ["G"], "new-task": ["Mod+Shift+J"] };
  expect(appShortcut(key("g"), context, bindings)).toBe("search");
  expect(
    appShortcut(key("g"), { ...context, editing: true }, bindings),
  ).toBeNull();
  expect(
    appShortcut(key("k", { metaKey: true }), context, bindings),
  ).toBeNull();
  expect(
    appShortcut(
      key("J", { metaKey: true, shiftKey: true }),
      { ...context, editing: true },
      bindings,
    ),
  ).toBe("new-task");
  expect(
    appShortcut(key("k", { metaKey: true }), context, { search: [] }),
  ).toBeNull();
});
