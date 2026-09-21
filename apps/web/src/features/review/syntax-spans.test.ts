import { test, expect } from "bun:test";
import {
  syntaxParts,
  validateSyntaxSpans,
} from "@/features/review/syntax-spans";

test("highlighted source remains byte-for-byte intact across gaps, newlines, Unicode and markup", () => {
  const source = 'const greeting = "Hi 🦋";\n<script>alert("hello")</script>\n';
  const spans = validateSyntaxSpans(source, [
    { type: "keyword", start: 0, end: 5 },
    { type: "string", start: 17, end: 24 },
  ]);
  expect(spans).not.toBeNull();
  expect(
    syntaxParts(source, spans!)
      .map((part) => part.text)
      .join(""),
  ).toBe(source);
  const offset = source.indexOf("\n") + 1;
  expect(
    syntaxParts(source, spans!, offset)
      .map((part) => part.text)
      .join(""),
  ).toBe(source.slice(offset));
  expect(
    syntaxParts(source, [], 2, 12)
      .map((part) => part.text)
      .join(""),
  ).toBe(source.slice(2, 12));
});

test("invalid, overlapping, out-of-range and surrogate-splitting spans fall back to plain text", () => {
  for (const spans of [
    [{ type: "<img onerror=alert(1)>", start: 0, end: 1 }],
    [{ type: "keyword", start: -1, end: 1 }],
    [{ type: "keyword", start: 0, end: 100 }],
    [{ type: "keyword", start: 2, end: 1 }],
    [
      { type: "keyword", start: 0, end: 2 },
      { type: "string", start: 1, end: 3 },
    ],
    [{ type: "keyword", start: "0", end: 1 }],
    [{ type: "keyword", start: 0, end: 1.5 }],
    [{ type: "keyword", start: 0, end: 1 }],
    null,
  ])
    expect(validateSyntaxSpans("🦋 abc", spans)).toBeNull();
});

test("diff line slices preserve multiline tokens and a missing final newline", () => {
  const source = "+const value = `first\n+second`;";
  const spans = validateSyntaxSpans(source, [
    { type: "string", start: 15, end: 29 },
  ])!;
  let offset = 0;
  const lines = source.split(/(?<=\n)/).map((line) => {
    const start = offset;
    offset += line.length;
    return syntaxParts(source, spans, start, offset)
      .map((part) => part.text)
      .join("");
  });
  expect(lines.join("")).toBe(source);
  expect(lines.at(-1)?.endsWith("\n")).toBe(false);
});
