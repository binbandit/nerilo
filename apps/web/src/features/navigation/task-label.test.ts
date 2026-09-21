import { expect, test } from "bun:test";
import { duplicateTaskLabels } from "@/features/navigation/task-label";

const task = (
  id: string,
  projectId = "project",
  title = "#4 · Priority queue",
  createdAt = "2026-09-20T12:00:00Z",
) => ({ id, projectId, title, createdAt });

test("duplicate task labels stay stable across recency order and visible filters", () => {
  const older = task(
    "earlier",
    "project",
    "#4 · Priority queue",
    "2026-09-20T11:00:00Z",
  );
  const newer = task("later");
  const labels = duplicateTaskLabels([newer, older]);
  expect(labels.get(older.id)).toBe("Workspace 1 · #4 · Priority queue");
  expect(labels.get(newer.id)).toBe("Workspace 2 · #4 · Priority queue");
  expect([...duplicateTaskLabels([older, newer])]).toEqual([...labels]);
  const visible = [newer].map((item) => labels.get(item.id) ?? item.title);
  expect(visible).toEqual(["Workspace 2 · #4 · Priority queue"]);
  expect(older.title).toBe("#4 · Priority queue");
});

test("matching timestamps use stable ids and other projects or titles stay distinct", () => {
  const labels = duplicateTaskLabels([
    task("b"),
    task("a"),
    task("other", "another-project"),
    task("unique", "project", "Resolve conflicts #4 · workspace 3"),
  ]);
  expect(labels.get("a")).toBe("Workspace 1 · #4 · Priority queue");
  expect(labels.get("b")).toBe("Workspace 2 · #4 · Priority queue");
  expect(labels.has("other")).toBe(false);
  expect(labels.has("unique")).toBe(false);
});
