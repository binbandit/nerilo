import { test, expect } from "bun:test";
import { ordered, taskSchema } from "@nerilo/protocol";
import { Store } from "./store";
import { Engine } from "./engine";
import { createApi } from "./api";

test("sidebar ordering preserves hidden tasks, stays within projects, and survives other settings updates", async () => {
  const store = new Store(":memory:");
  const api = createApi(store, new Engine(store, true), "test");
  const post = (path: string, body: unknown) =>
    api(
      new Request(`http://localhost/${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer test" },
        body: JSON.stringify(body),
      }),
    );
  try {
    for (const id of ["one", "two"])
      store.put("project", id, {
        id,
        name: id,
        path: `/tmp/${id}`,
        repository: null,
        setup: "",
        verify: "",
        branch: "main",
        createdAt: "now",
        archived: false,
      });
    for (const [id, projectId] of [
      ["a", "one"],
      ["hidden", "one"],
      ["b", "one"],
      ["other", "two"],
    ]) {
      store.put(
        "task",
        id,
        taskSchema.parse({
          id,
          projectId,
          title: id,
          provider: "codex",
          presetId: "programmer",
          model: "",
          status: "ready",
          sessionId: null,
          baseCommit: null,
          includeChanges: false,
          pending: [],
          activeTurnId: null,
          createdAt: "now",
          updatedAt: "now",
          archived: id === "hidden",
          error: null,
          stopRequested: false,
        }),
      );
    }
    expect(
      (
        await post("sidebar-order", {
          kind: "project",
          id: "two",
          overId: "one",
          edge: "before",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await post("sidebar-order", {
          kind: "task",
          id: "b",
          overId: "a",
          edge: "before",
        })
      ).ok,
    ).toBe(true);
    expect(store.get("settings", "default")?.sidebarOrder).toEqual({
      projects: ["two", "one"],
      tasks: { one: ["b", "a", "hidden"] },
    });
    expect(
      (
        await post("sidebar-order", {
          kind: "task",
          id: "b",
          overId: "other",
          edge: "after",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await post("sidebar-order", {
          kind: "project",
          id: "missing",
          overId: "one",
          edge: "before",
        })
      ).status,
    ).toBe(400);
    await post("settings", { appearance: "dark", concurrency: 1 });
    expect(store.get("settings", "default")?.sidebarOrder.projects).toEqual([
      "two",
      "one",
    ]);
    expect(
      ordered(
        [{ id: "new" }, { id: "a" }, { id: "b" }],
        store.get("settings", "default")!.sidebarOrder.tasks.one,
      ).map((t) => t.id),
    ).toEqual(["b", "a", "new"]);
    expect(store.get("task", "b")?.projectId).toBe("one");
  } finally {
    store.db.close();
  }
});
