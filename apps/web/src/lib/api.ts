import { machineApiUrl } from "@/features/machines/machine-location";

export function apiUrl(path: string, machineId?: string) {
  return machineApiUrl(
    path,
    machineId === undefined
      ? typeof window === "undefined"
        ? ""
        : window.location.search
      : new URLSearchParams({ machine: machineId }).toString(),
  );
}
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
async function responseData(response: Response): Promise<unknown> {
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiError(
      response.ok
        ? "Nerilo returned an unexpected response. Reload this view and try again."
        : "Nerilo is temporarily unavailable. Try reconnecting in a moment.",
      response.status,
    );
  }
  if (!response.ok)
    throw new ApiError(
      data && typeof data === "object" && "error" in data
        ? String(data.error)
        : "The request failed.",
      response.status,
    );
  return data;
}

export async function read(
  path: string,
  signal?: AbortSignal,
  machineId?: string,
) {
  return responseData(
    await fetch(apiUrl(path, machineId), { cache: "no-store", signal }),
  );
}
const retryKeys = new Map<string, string>();
export async function mutate(
  path: string,
  body: unknown = {},
  signal?: AbortSignal,
  machineId?: string,
) {
  const url = apiUrl(path, machineId);
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
    signal,
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: content,
  });
  // A lost response may follow successful acceptance. Keep the same key until
  // a retry returns a usable result or an explicit rejection.
  if (response.status >= 400 && response.status < 500)
    retryKeys.delete(requestKey);
  const data = await responseData(response);
  retryKeys.delete(requestKey);
  return data;
}
