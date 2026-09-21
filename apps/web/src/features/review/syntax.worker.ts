import {
  syntaxLimit,
  validateSyntaxSpans,
} from "@/features/review/syntax-spans";

const worker = globalThis as unknown as Pick<
  Worker,
  "onmessage" | "postMessage"
>;
worker.onmessage = async (event: MessageEvent<unknown>) => {
  const value = event.data;
  if (
    !value ||
    typeof value !== "object" ||
    !("id" in value) ||
    !Number.isSafeInteger(value.id) ||
    !("source" in value) ||
    typeof value.source !== "string" ||
    value.source.length > syntaxLimit
  )
    return;
  try {
    const { parse } = await import("gpu-lexer");
    const spans = validateSyntaxSpans(value.source, await parse(value.source));
    worker.postMessage({
      id: value.id,
      spans,
      backend: spans ? "webgpu" : "plain",
    });
  } catch {
    worker.postMessage({ id: value.id, spans: null, backend: "unavailable" });
  }
};
