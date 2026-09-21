import { expect, test } from "bun:test";
import {
  sidebarDestination,
  sidebarFocusAfterRemoval,
  type SidebarRow,
} from "@/features/navigation/sidebar-keyboard";

const rows: SidebarRow[] = [
  { key: "project:one", kind: "project", id: "one", open: true },
  { key: "task:a", kind: "task", id: "a", projectId: "one" },
  { key: "task:b", kind: "task", id: "b", projectId: "one" },
  { key: "project:two", kind: "project", id: "two", open: false },
];
test("sidebar navigation traverses visible rows without wrapping or opening tasks", () => {
  expect(sidebarDestination(rows, "project:one", "ArrowDown")).toEqual({
    focus: "task:a",
  });
  expect(sidebarDestination(rows, "task:b", "ArrowDown")).toEqual({
    focus: "project:two",
  });
  expect(sidebarDestination(rows, "project:two", "ArrowDown")).toEqual({
    focus: "project:two",
  });
  expect(sidebarDestination(rows, "project:one", "ArrowUp")).toEqual({
    focus: "project:one",
  });
  expect(sidebarDestination(rows, "task:b", "Home")).toEqual({
    focus: "project:one",
  });
  expect(sidebarDestination(rows, "task:a", "End")).toEqual({
    focus: "project:two",
  });
  expect(sidebarDestination(rows, "task:a", "Enter")).toBeNull();
  expect(sidebarDestination(rows, "hidden-task", "ArrowDown")).toBeNull();
});
test("right expands or enters a project and left goes to its parent or collapses it", () => {
  expect(sidebarDestination(rows, "project:two", "ArrowRight")).toEqual({
    expanded: { id: "two", open: true },
  });
  expect(sidebarDestination(rows, "project:one", "ArrowRight")).toEqual({
    focus: "task:a",
  });
  expect(sidebarDestination(rows, "task:b", "ArrowLeft")).toEqual({
    focus: "project:one",
  });
  expect(sidebarDestination(rows, "project:one", "ArrowLeft")).toEqual({
    expanded: { id: "one", open: false },
  });
  expect(sidebarDestination(rows, "project:two", "ArrowLeft")).toBeNull();
  expect(
    sidebarDestination(
      rows.filter((row) => row.kind === "project"),
      "project:one",
      "ArrowRight",
    ),
  ).toBeNull();
});
test("removing a task prefers its next sibling, then previous sibling, then project", () => {
  expect(sidebarFocusAfterRemoval(rows, "task:a")).toEqual([
    "task:b",
    "project:one",
    "project:two",
  ]);
  expect(sidebarFocusAfterRemoval(rows, "task:b")[0]).toBe("task:a");
  expect(
    sidebarFocusAfterRemoval(
      rows.filter((row) => row.key !== "task:b"),
      "task:a",
    )[0],
  ).toBe("project:one");
  expect(sidebarFocusAfterRemoval(rows, "project:one")[0]).toBe("project:two");
});
