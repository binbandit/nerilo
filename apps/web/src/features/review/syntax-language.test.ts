import { expect, test } from "bun:test";
import {
  diffHunkLines,
  diffSyntaxLines,
  diffSyntaxSource,
  hasSyntax,
} from "@/features/review/syntax-language";

test("plain text and unknown files never borrow a code language", () => {
  for (const path of [
    "notes.txt",
    "Dockerfile.txt",
    ".env.txt",
    "README.md",
    "output.log",
    "LICENSE",
    "data.unknown",
  ])
    expect(hasSyntax({ path, language: "javascript" })).toBe(false);
  for (const language of [undefined, "text", "plaintext", "txt", "console"])
    expect(hasSyntax({ language })).toBe(false);
  for (const path of [
    "app.TSX",
    "app.py",
    "Dockerfile",
    "Dockerfile.dev",
    ".env.local",
  ])
    expect(hasSyntax({ path })).toBe(true);
  expect(hasSyntax({ language: "typescript" })).toBe(true);
});

test("mixed diffs preserve code highlighting without coloring text files", () => {
  const text =
    "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+const count = 2;\ndiff --git a/notes.txt b/notes.txt\n--- a/notes.txt\n+++ b/notes.txt\n+There are 2 items.\n";
  const lines = diffSyntaxLines(text);
  expect(lines[3]).toBe(true);
  expect(lines[4]).toBe(false);
  expect(lines[7]).toBe(false);
  expect(
    diffSyntaxLines('--- "a/old file.py"\n+++ /dev/null\n-print(2)\n'),
  ).toEqual([true, true, true]);
  expect(
    diffSyntaxLines('--- /dev/null\n+++ "b/new file.txt"\n+true 2\n'),
  ).toEqual([false, false, false]);
});

test("diff lexing excludes prose and metadata without shifting source offsets", () => {
  const text =
    '--- a/notes.txt\n+++ b/notes.txt\n@@ -0,0 +1 @@\n+true 42 \"hello\"\n--- a/app.ts\n+++ b/app.ts\n@@ -0,0 +1 @@\n+const count = 42;\n';
  const source = diffSyntaxSource(text);
  expect(source.length).toBe(text.length);
  expect(source).not.toContain("hello");
  expect(source).not.toContain("---");
  expect(source.indexOf("const count")).toBe(text.indexOf("const count"));
  expect(source.split("\n").length).toBe(text.split("\n").length);
});

test("hunk content resembling file headers keeps highlighting and quoted paths decode", () => {
  const text =
    "diff --git a/q.sql b/q.sql\n--- a/q.sql\n+++ b/q.sql\n@@ -1,2 +1,2 @@\n--- removed comment\n+++ added text\n select 1;\ndiff --git a/n.txt b/n.txt\n--- a/n.txt\n+++ b/n.txt\n@@ -1 +1 @@\n-a\n+b\n";
  expect(diffHunkLines(text)).toEqual([
    false,
    false,
    false,
    false,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
    true,
    true,
  ]);
  expect(diffSyntaxLines(text).slice(0, 7)).toEqual([
    false,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
  expect(diffSyntaxLines(text).slice(8)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
  const source = diffSyntaxSource(text);
  expect(source).toContain("-- removed comment");
  expect(source).toContain("select 1;");
  expect(
    diffSyntaxLines('--- "a/\\303\\244.py"\n+++ "b/\\303\\244.py"\n+x = 1\n'),
  ).toEqual([true, true, true]);
});
