import { snapshotSchema, detailSchema } from "@nerilo/protocol";
import { machineApiUrl } from "./machine-location";

export function apiUrl(path: string) {
  return machineApiUrl(
    path,
    typeof window === "undefined" ? "" : window.location.search,
  );
}

export async function read(path: string) {
  const response = await fetch(apiUrl(path), { cache: "no-store" });
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "The request failed.",
    );
  return data;
}
export const loadSnapshot = async (bootstrap = false) =>
  snapshotSchema.parse(await read(bootstrap ? "bootstrap" : "snapshot"));
export const loadTask = async (id: string) =>
  detailSchema.parse(await read(`tasks/${id}`));
const retryKeys = new Map<string, string>();
export async function mutate(path: string, body: unknown = {}) {
  const url = apiUrl(path);
  const content = JSON.stringify(body);
  const retryable =
    path === "tasks" || /^tasks\/[^/]+\/(follow-up|queue)$/.test(path);
  const requestKey = `${url}\n${content}`;
  const key = (retryable && retryKeys.get(requestKey)) || crypto.randomUUID();
  if (retryable) {
    retryKeys.set(requestKey, key);
    if (retryKeys.size > 64) retryKeys.delete(retryKeys.keys().next().value!);
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: content,
  });
  // A lost response may follow successful acceptance. Keep the same key until
  // a retry returns a usable result or an explicit rejection.
  if (response.status >= 400 && response.status < 500)
    retryKeys.delete(requestKey);
  const data: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "The request failed.",
    );
  retryKeys.delete(requestKey);
  return data;
}
