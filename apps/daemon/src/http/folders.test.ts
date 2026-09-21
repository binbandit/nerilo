import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { folderListingSchema } from "@nerilo/protocol";
import { Store } from "../platform/store";
import { Engine } from "../tasks/engine";
import { createApi } from "./api";

test("folders requires authentication, validates paths and only serves GET", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerilo-folders-api-"));
  const store = new Store(":memory:");
  const api = createApi(store, new Engine(store, true), "test");
  const request = (query: string, method = "GET", authorized = true) =>
    api(
      new Request(`http://localhost/folders${query}`, {
        method,
        headers: authorized ? { Authorization: "Bearer test" } : {},
      }),
    );
  try {
    expect((await request("", "GET", false)).status).toBe(401);
    const response = await request(`?path=${encodeURIComponent(root)}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(folderListingSchema.parse(await response.json())).toMatchObject({
      path: await realpath(root),
      directories: [],
      selectable: false,
    });
    for (const query of [
      "?path=relative",
      "?path=",
      "?path=%00",
      "?path=/&path=/tmp",
    ])
      expect((await request(query)).status).toBe(400);
    const missing = await request(
      `?path=${encodeURIComponent(join(root, "missing"))}`,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("no longer available"),
    });
    expect((await request("", "POST")).status).toBe(404);
  } finally {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});
