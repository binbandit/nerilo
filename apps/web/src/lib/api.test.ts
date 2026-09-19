import { expect, spyOn, test } from "bun:test";
import { mutate } from "./api";

test("retrying an uncertain task submission reuses its idempotency key", async () => {
  const keys: (string | null)[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key"));
        if (keys.length === 1)
          throw new TypeError("Connection lost after acceptance");
        return Response.json({ id: "task" });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    const input = { prompt: "One request" };
    await expect(mutate("tasks", input)).rejects.toThrow();
    await mutate("tasks", input);
    expect(keys[1]).toBe(keys[0]);
    await mutate("tasks", input);
    expect(keys[2]).not.toBe(keys[1]);
  } finally {
    mock.mockRestore();
  }
});
