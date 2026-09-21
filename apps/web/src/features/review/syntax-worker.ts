import {
  syntaxLimit,
  validateSyntaxSpans,
  type SyntaxSpan,
} from "@/features/review/syntax-spans";

let worker: Worker | null = null;
let unavailable = false;
let sequence = 0;
type Request = {
  source: string;
  resolve: (spans: SyntaxSpan[] | null) => void;
  timer: ReturnType<typeof setTimeout>;
};
const pending = new Map<number, Request>();
const cache = new Map<string, Promise<SyntaxSpan[] | null>>();
function stop() {
  unavailable = true;
  worker?.terminate();
  worker = null;
  for (const item of pending.values()) {
    clearTimeout(item.timer);
    item.resolve(null);
  }
  pending.clear();
}
export function highlightSource(source: string) {
  if (
    !source ||
    source.length > syntaxLimit ||
    unavailable ||
    typeof Worker === "undefined"
  )
    return Promise.resolve(null);
  const cached = cache.get(source);
  if (cached) return cached;
  if (pending.size >= 32) return Promise.resolve(null);
  if (!worker) {
    try {
      worker = new Worker(new URL("./syntax.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<unknown>) => {
        const value = event.data;
        if (
          !value ||
          typeof value !== "object" ||
          !("id" in value) ||
          typeof value.id !== "number"
        )
          return;
        const item = pending.get(value.id);
        if (!item) return;
        if ("backend" in value && value.backend === "unavailable") {
          stop();
          return;
        }
        clearTimeout(item.timer);
        pending.delete(value.id);
        item.resolve(
          "spans" in value
            ? validateSyntaxSpans(item.source, value.spans)
            : null,
        );
      };
      worker.onerror = (event) => {
        event.preventDefault();
        stop();
      };
    } catch {
      stop();
      return Promise.resolve(null);
    }
  }
  const result = new Promise<SyntaxSpan[] | null>((resolve) => {
    const id = ++sequence;
    pending.set(id, { source, resolve, timer: setTimeout(stop, 15000) });
    worker!.postMessage({ id, source });
  });
  cache.set(source, result);
  if (cache.size > 32) cache.delete(cache.keys().next().value!);
  return result;
}
