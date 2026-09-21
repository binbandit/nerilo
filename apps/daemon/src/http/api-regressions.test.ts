import { expect, spyOn, test } from "bun:test";
import { projectSchema, taskSchema } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { Engine } from "../tasks/engine";
import { createApi } from "./api";

test("idempotency is scoped to the operation and task, and archived tasks cannot be retried", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store, true);
  const tick = spyOn(engine, "tick").mockResolvedValue();
  store.put(
    "project",
    "project",
    projectSchema.parse({
      id: "project",
      name: "Fixture",
      path: "/tmp/fixture",
      branch: "main",
      createdAt: "now",
    }),
  );
  const api = createApi(store, engine, "test");
  const post = (path: string, body: unknown, key = crypto.randomUUID()) =>
    api(
      new Request(`http://localhost/${path}`, {
        method: "POST",
        headers: { Authorization: "Bearer test", "Idempotency-Key": key },
        body: JSON.stringify(body),
      }),
    );
  try {
    const key = crypto.randomUUID();
    const input = {
      projectId: "project",
      presetId: "programmer",
      prompt: "First request",
    };
    const first = taskSchema.parse(
      await (await post("tasks", input, key)).json(),
    );
    const replay = taskSchema.parse(
      await (await post("tasks", input, key)).json(),
    );
    expect(replay.id).toBe(first.id);
    const second = taskSchema.parse(await (await post("tasks", input)).json());
    for (const task of [first, second]) {
      expect(
        (await post(`tasks/${task.id}/follow-up`, { text: "Follow up" }, key))
          .status,
      ).toBe(200);
      await post(`tasks/${task.id}/follow-up`, { text: "Follow up" }, key);
      expect(store.get("task", task.id)?.pending).toHaveLength(2);
    }
    await post(`tasks/${first.id}/archive`, { archived: true });
    expect((await post(`tasks/${first.id}/retry`, {})).status).toBe(400);
  } finally {
    tick.mockRestore();
    store.db.close();
  }
});

test("editing an unused project cannot duplicate an existing repository registration", async () => {
  const store = new Store(":memory:");
  const engine = new Engine(store, true);
  const validate = spyOn(engine, "validateProject").mockImplementation(
    async (path) => ({ path, branch: "main" }),
  );
  try {
    for (const id of ["one", "two"])
      store.put(
        "project",
        id,
        projectSchema.parse({
          id,
          name: id,
          path: `/tmp/${id}`,
          branch: "main",
          createdAt: "now",
        }),
      );
    const api = createApi(store, engine, "test");
    const response = await api(
      new Request("http://localhost/projects/two", {
        method: "POST",
        headers: { Authorization: "Bearer test" },
        body: JSON.stringify({ name: "Duplicate", path: "/tmp/one" }),
      }),
    );
    expect(response.status).toBe(400);
    expect(store.get("project", "two")?.path).toBe("/tmp/two");
  } finally {
    validate.mockRestore();
    store.db.close();
  }
});
