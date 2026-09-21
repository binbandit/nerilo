import type { Task } from "@nerilo/protocol";
import type { Store } from "../platform/store";
import type { Engine } from "../tasks/engine";

export type ApiContext = {
  store: Store;
  engine: Engine;
  requireTask: (id: string) => Task;
  schedule: () => void;
};

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
