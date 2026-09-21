import { expect, test } from "bun:test";
import { readRequestText, RequestTooLargeError } from "@nerilo/protocol";
import { Engine } from "../tasks/engine";
import { Store } from "../platform/store";
import { createApi } from "./api";

test("body limits apply while streaming, including multibyte text without Content-Length", async () => {
  let cancelled = false;
  const request = new Request("http://localhost", {
    method: "POST",
    body: new ReadableStream({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("é".repeat(10)));
      },
      cancel() {
        cancelled = true;
      },
    }),
  });
  await expect(readRequestText(request, 25)).rejects.toBeInstanceOf(
    RequestTooLargeError,
  );
  expect(cancelled).toBe(true);
  expect(
    await readRequestText(
      new Request("http://localhost", { method: "POST", body: "é" }),
      2,
    ),
  ).toBe("é");
});

test("the API rejects oversized streamed bodies and closes already-aborted event streams", async () => {
  const store = new Store(":memory:");
  const api = createApi(store, new Engine(store, true), "test");
  try {
    const response = await api(
      new Request("http://localhost/settings", {
        method: "POST",
        headers: { Authorization: "Bearer test" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(100001));
            controller.close();
          },
        }),
      }),
    );
    expect(response.status).toBe(413);
    const abort = new AbortController();
    abort.abort();
    const stream = await api(
      new Request("http://localhost/events", {
        headers: { Authorization: "Bearer test" },
        signal: abort.signal,
      }),
    );
    const reader = stream.body!.getReader();
    try {
      expect((await reader.read()).done).toBe(true);
    } finally {
      await reader.cancel();
    }
  } finally {
    store.db.close();
  }
});
