import { expect, spyOn, test } from "bun:test";
import { mutate } from "@/lib/api";

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

test("an HTML server failure explains recovery and preserves an uncertain submission for retry", async () => {
  const keys: (string | null)[] = [];
  const mock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (
        _input: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        keys.push(new Headers(init?.headers).get("Idempotency-Key"));
        return keys.length === 1
          ? new Response("<!doctype html><h1>Unavailable</h1>", { status: 502 })
          : Response.json({ id: "task" });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  try {
    const input = { prompt: "Keep my request" };
    await expect(mutate("tasks", input)).rejects.toThrow("Try reconnecting");
    await mutate("tasks", input);
    expect(keys[1]).toBe(keys[0]);
  } finally {
    mock.mockRestore();
  }
});

test.each([400, 500])(
  "a JSON failure with status %i reports the server error and handles retry identity",
  async (status) => {
    const keys: (string | null)[] = [];
    const mock = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(
        async (
          _input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ) => {
          keys.push(new Headers(init?.headers).get("Idempotency-Key"));
          return keys.length === 1
            ? Response.json({ error: "Please try again." }, { status })
            : Response.json({ id: "task" });
        },
        { preconnect: fetch.preconnect },
      ),
    );
    try {
      const input = { prompt: `Retry after a ${status} response` };
      await expect(mutate("tasks", input)).rejects.toThrow("Please try again.");
      await mutate("tasks", input);
      // A server failure may follow acceptance; a client rejection is definitive.
      expect(keys[1] === keys[0]).toBe(status >= 500);
    } finally {
      mock.mockRestore();
    }
  },
);
