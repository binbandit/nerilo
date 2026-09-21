export const syntaxTypes = [
  "plain",
  "comment",
  "string",
  "number",
  "keyword",
  "type",
  "function",
  "constant",
  "operator",
] as const;
export type SyntaxType = (typeof syntaxTypes)[number];
export type SyntaxSpan = { type: SyntaxType; start: number; end: number };
export const syntaxLimit = 80000;

export function validateSyntaxSpans(
  source: string,
  value: unknown,
): SyntaxSpan[] | null {
  if (!Array.isArray(value) || value.length > 20000) return null;
  const spans: SyntaxSpan[] = [];
  let end = 0;
  const insideSurrogate = (offset: number) =>
    offset > 0 &&
    offset < source.length &&
    source.charCodeAt(offset - 1) >= 0xd800 &&
    source.charCodeAt(offset - 1) <= 0xdbff &&
    source.charCodeAt(offset) >= 0xdc00 &&
    source.charCodeAt(offset) <= 0xdfff;
  for (const candidate of value as unknown[]) {
    if (!candidate || typeof candidate !== "object") return null;
    const span = candidate as {
      type?: unknown;
      start?: unknown;
      end?: unknown;
    };
    if (
      typeof span.type !== "string" ||
      !syntaxTypes.includes(span.type as SyntaxType) ||
      typeof span.start !== "number" ||
      typeof span.end !== "number" ||
      !Number.isSafeInteger(span.start) ||
      !Number.isSafeInteger(span.end) ||
      span.start < end ||
      span.end <= span.start ||
      span.end > source.length ||
      insideSurrogate(span.start) ||
      insideSurrogate(span.end)
    )
      return null;
    spans.push({
      type: span.type as SyntaxType,
      start: span.start,
      end: span.end,
    });
    end = span.end;
  }
  return spans;
}

export function syntaxParts(
  source: string,
  spans: SyntaxSpan[],
  start = 0,
  end = source.length,
) {
  const parts: { type: SyntaxType; text: string; start: number }[] = [];
  let cursor = start;
  let low = 0,
    high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (spans[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  for (
    let index = low;
    index < spans.length && spans[index].start < end;
    index++
  ) {
    const span = spans[index];
    const from = Math.max(start, span.start),
      to = Math.min(end, span.end);
    if (from > cursor)
      parts.push({
        type: "plain",
        text: source.slice(cursor, from),
        start: cursor,
      });
    parts.push({ type: span.type, text: source.slice(from, to), start: from });
    cursor = to;
  }
  if (cursor < end)
    parts.push({
      type: "plain",
      text: source.slice(cursor, end),
      start: cursor,
    });
  return parts;
}
