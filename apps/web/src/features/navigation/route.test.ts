import { expect, test } from "bun:test";
import { parseRoute } from "@/features/navigation/route";

test.each([
  "home",
  "archive",
  "projects",
  "agents",
  "library",
  "settings",
  "settings/appearance",
  "settings/environment",
  "settings/keyboard",
  "task/abc",
  "project/abc/prs",
])("keeps existing links to %s", (route) => {
  expect(parseRoute(`#${route}`)).toBe(route);
});

test.each([
  "",
  "#",
  "#main",
  "#settings/missing",
  "#task/",
  "#project/a/invalid",
])("unknown route %s falls back to home", (route) => {
  expect(parseRoute(route)).toBe("home");
});
