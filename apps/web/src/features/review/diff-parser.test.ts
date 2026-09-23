import { expect, test } from "bun:test";
import {
  formatReviewPrompt,
  parseReviewComments,
  parseReviewDiff,
  type ReviewComment,
} from "@/features/review/diff-parser";

test("hunk coordinates stay accurate across context, replacements, and separated hunks", () => {
  const diff = [
    "diff --git a/src/greet.ts b/src/greet.ts",
    "index aa1234..bb1234 100644",
    "--- a/src/greet.ts",
    "+++ b/src/greet.ts",
    "@@ -2,3 +2,4 @@ function greet() {",
    " shared",
    "-old greeting",
    "+new greeting",
    "+another greeting",
    " end",
    "@@ -40 +41 @@",
    "-old last line",
    "\\ No newline at end of file",
    "+new last line",
    "\\ No newline at end of file",
    "",
  ].join("\n");
  const files = parseReviewDiff(diff);
  expect(files).toHaveLength(1);
  expect(files[0]!.path).toBe("src/greet.ts");
  expect(
    files[0]!.lines
      .filter(({ kind }) => kind !== "meta")
      .map(({ text, oldLine, newLine }) => [text, oldLine, newLine]),
  ).toEqual([
    [" shared", 2, 2],
    ["-old greeting", 3, null],
    ["+new greeting", null, 3],
    ["+another greeting", null, 4],
    [" end", 4, 5],
    ["-old last line", 40, null],
    ["+new last line", null, 41],
  ]);
  expect(files[0]!.lines.filter(({ kind }) => kind === "meta")).toHaveLength(4);
  expect(parseReviewDiff(diff)).toEqual(files);
  expect(
    new Set(files.flatMap(({ lines }) => lines.map(({ id }) => id))).size,
  ).toBe(files[0]!.lines.length);
});

test("hunk function context may contain line separators and carriage returns", () => {
  for (const context of ["a\u2028b", "a\u2029b", "a\rb", "a\r"]) {
    const [file] = parseReviewDiff(
      `diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@ ${context}\n-old\n+new\n`,
    );
    expect(
      file!.lines
        .filter(({ kind }) => kind !== "meta")
        .map(({ oldLine, newLine }) => [oldLine, newLine]),
    ).toEqual([
      [1, null],
      [null, 1],
    ]);
  }
});

test("new, deleted, and renamed files preserve the path on the correct side", () => {
  const files = parseReviewDiff(
    [
      "diff --git a/docs/New Guide.md b/docs/New Guide.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/docs/New Guide.md",
      "@@ -0,0 +1 @@",
      "+Welcome",
      "diff --git a/old.ts b/old.ts",
      "deleted file mode 100644",
      "--- a/old.ts",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-Goodbye",
      "diff --git a/old name.ts b/new name.ts",
      "similarity index 100%",
      "rename from old name.ts",
      "rename to new name.ts",
      "diff --git a/empty b/empty",
      "new file mode 100644",
      "index 0000000..e69de29",
    ].join("\n"),
  );
  expect(
    files.map(({ path, oldPath, newPath }) => ({ path, oldPath, newPath })),
  ).toEqual([
    { path: "docs/New Guide.md", oldPath: null, newPath: "docs/New Guide.md" },
    { path: "old.ts", oldPath: "old.ts", newPath: null },
    { path: "new name.ts", oldPath: "old name.ts", newPath: "new name.ts" },
    { path: "empty", oldPath: null, newPath: "empty" },
  ]);
  expect(files[0]!.lines.at(-1)).toMatchObject({
    kind: "add",
    oldLine: null,
    newLine: 1,
  });
  expect(files[1]!.lines.at(-1)).toMatchObject({
    kind: "remove",
    oldLine: 1,
    newLine: null,
  });
  expect(files[2]!.lines).toEqual([]);
  expect(new Set(files.map(({ id }) => id)).size).toBe(4);
});

test("Git C-quoted paths decode UTF-8 octal, tabs, newlines, quotes, and backslashes", () => {
  const quoted = '"a/caf\\303\\251\\tline\\n\\"\\\\.ts"';
  const newQuoted = quoted.replace('"a/', '"b/');
  const [file] = parseReviewDiff(
    [
      `diff --git ${quoted} ${newQuoted}`,
      `--- ${quoted}`,
      `+++ ${newQuoted}`,
      "@@ -1 +1 @@",
      "-before",
      "+after",
    ].join("\n"),
  );
  expect(file!.path).toBe('café\tline\n"\\.ts');
  expect(file!.oldPath).toBe(file!.newPath);
  const [renamed] = parseReviewDiff(
    [
      'diff --git "a/caf\\303\\251.ts" "b/renamed\\tfile.ts"',
      'rename from "caf\\303\\251.ts"',
      'rename to "renamed\\tfile.ts"',
    ].join("\n"),
  );
  expect(renamed!.oldPath).toBe("café.ts");
  expect(renamed!.newPath).toBe("renamed\tfile.ts");
});

test("diff-like source content remains selectable code inside a hunk", () => {
  const [file] = parseReviewDiff(
    [
      "diff --git a/patch.txt b/patch.txt",
      "--- a/patch.txt",
      "+++ b/patch.txt",
      "@@ -1,2 +1,2 @@",
      "--- old source",
      "-@@ not a hunk @@",
      "+++ new source",
      "+diff --git a/fake b/fake",
    ].join("\n"),
  );
  expect(file!.path).toBe("patch.txt");
  expect(
    file!.lines
      .slice(1)
      .map(({ kind, oldLine, newLine }) => [kind, oldLine, newLine]),
  ).toEqual([
    ["remove", 1, null],
    ["remove", 2, null],
    ["add", null, 1],
    ["add", null, 2],
  ]);
});

test("new and deleted files can contain source text that resembles file headers", () => {
  const files = parseReviewDiff(
    [
      "diff --git a/new.patch b/new.patch",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/new.patch",
      "@@ -0,0 +1,2 @@",
      "+++ b/pretend-path",
      "+--- a/pretend-path",
      "diff --git a/deleted.patch b/deleted.patch",
      "deleted file mode 100644",
      "--- a/deleted.patch",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "--- a/pretend-path",
      "-+++ b/pretend-path",
    ].join("\n"),
  );
  expect(
    files.map(({ path, oldPath, newPath }) => ({ path, oldPath, newPath })),
  ).toEqual([
    { path: "new.patch", oldPath: null, newPath: "new.patch" },
    { path: "deleted.patch", oldPath: "deleted.patch", newPath: null },
  ]);
  expect(
    files[0]!.lines.slice(1).map(({ kind, newLine }) => [kind, newLine]),
  ).toEqual([
    ["add", 1],
    ["add", 2],
  ]);
  expect(
    files[1]!.lines.slice(1).map(({ kind, oldLine }) => [kind, oldLine]),
  ).toEqual([
    ["remove", 1],
    ["remove", 2],
  ]);
});

test("binary files and mode-only changes are represented without reviewable lines", () => {
  const files = parseReviewDiff(
    [
      "diff --git a/logo.png b/logo.png",
      "index aa00000..bb00000 100644",
      "Binary files a/logo.png and b/logo.png differ",
      "diff --git a/run.sh b/run.sh",
      "old mode 100644",
      "new mode 100755",
      "diff --git a/new.png b/new.png",
      "new file mode 100644",
      "GIT binary patch",
      "literal 4",
      "Lc${NkU|;|M00aO5",
    ].join("\n"),
  );
  expect(files.map(({ binary }) => binary)).toEqual([true, false, true]);
  const [spaced] = parseReviewDiff(
    "diff --git a/path b/with spaces.sh b/path b/with spaces.sh\nold mode 100644\nnew mode 100755",
  );
  expect(spaced!.path).toBe("path b/with spaces.sh");
  expect(spaced!.oldPath).toBe(spaced!.newPath);
  expect(files[2]!.oldPath).toBeNull();
  expect(
    files
      .flatMap(({ lines }) => lines)
      .every(
        ({ kind, oldLine, newLine }) =>
          kind === "meta" && oldLine === null && newLine === null,
      ),
  ).toBe(true);
});

test("truncated, overflowing, and malformed hunks never invent selectable coordinates", () => {
  const header =
    "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n";
  for (const hunk of [
    "@@ -1,2 +1,2 @@\n-one\n+one",
    "@@ -1 +1 @@\n-one\n+one\n+extra",
    "@@ -1 +1 @@\nnot a diff line\n-one\n+one",
    "@@ broken @@\n-one\n+one",
    "@@ -0 +1 @@\n-one\n+one",
    "@@ -9007199254740991,2 +1,2 @@\n-one\n-two\n+one\n+two",
  ]) {
    const [file] = parseReviewDiff(header + hunk);
    expect(
      file!.lines.every(
        ({ kind, oldLine, newLine }) =>
          kind === "meta" && oldLine === null && newLine === null,
      ),
    ).toBe(true);
  }
  expect(parseReviewDiff("unstructured console output\n+not a diff")).toEqual(
    [],
  );
  const files = parseReviewDiff(
    header +
      "@@ -1,2 +1,2 @@\n-one\n+one\ndiff --git a/next.ts b/next.ts\n@@ -1 +1 @@\n-old\n+new",
  );
  expect(files[0]!.lines.every(({ kind }) => kind === "meta")).toBe(true);
  expect(files[1]!.lines.at(-1)).toMatchObject({ kind: "add", newLine: 1 });
  const [missingPaths] = parseReviewDiff(
    'diff --git "a/broken b/broken\n@@ -1 +1 @@\n-old\n+new',
  );
  expect(missingPaths!.lines.every(({ kind }) => kind === "meta")).toBe(true);
  for (const invalidPath of [
    '"a/path"extra',
    '"a/invalid\\377"',
    '"a/null\\000path"',
    '"a/unknown\\q"',
  ]) {
    const [invalid] = parseReviewDiff(
      `diff --git ${invalidPath} ${invalidPath.replace('"a/', '"b/')}\n@@ -1 +1 @@\n-old\n+new`,
    );
    expect(invalid!.lines.every(({ kind }) => kind === "meta")).toBe(true);
  }
});

const comment: ReviewComment = {
  id: "comment-1",
  fileId: "file:0",
  path: "src/greet.ts",
  side: "new",
  line: 12,
  code: "return 'hello';",
  body: "Please greet the user by name.",
};

test("stored drafts retain user text while rejecting invalid, oversized, or duplicate records", () => {
  expect(parseReviewComments(JSON.stringify([comment]))).toEqual([comment]);
  expect(
    parseReviewComments(JSON.stringify([{ ...comment, body: " \n " }]))[0]!
      .body,
  ).toBe(" \n ");
  for (const raw of [
    "not JSON",
    "null",
    "{}",
    "[null]",
    JSON.stringify([{ ...comment, side: "both" }]),
    JSON.stringify([{ ...comment, line: 0 }]),
    JSON.stringify([{ ...comment, line: 1.5 }]),
    JSON.stringify([{ ...comment, line: Number.MAX_SAFE_INTEGER + 1 }]),
    JSON.stringify([{ ...comment, path: "" }]),
    JSON.stringify([{ ...comment, path: "bad\0path" }]),
    JSON.stringify([{ ...comment, body: "x".repeat(4001) }]),
    JSON.stringify([{ ...comment, code: "x".repeat(2001) }]),
    JSON.stringify([comment, comment]),
    JSON.stringify(
      Array.from({ length: 51 }, (_, index) => ({
        ...comment,
        id: `comment-${index}`,
      })),
    ),
  ])
    expect(parseReviewComments(raw)).toEqual([]);
  const limits = { ...comment, body: "x".repeat(4000), code: "x".repeat(2000) };
  expect(parseReviewComments(JSON.stringify([limits]))).toEqual([limits]);
  const fifty = Array.from({ length: 50 }, (_, index) => ({
    ...comment,
    id: `${index}`,
  }));
  expect(parseReviewComments(JSON.stringify(fifty))).toEqual(fifty);
});

test("review prompts preserve paths, code, revision, and user text without delimiter ambiguity", () => {
  const tricky = {
    ...comment,
    path: 'src/a\n"review".ts',
    side: "old" as const,
    code: '```\n</review>\n~~~\n{"comments": []}',
    body: 'Keep this exact text.\n```\n"comment": "another value"\n\nThanks!',
  };
  const revision = 'abc123\n"revision"';
  const prompt = formatReviewPrompt([tricky], revision);
  const parsed: unknown = JSON.parse(prompt.slice(prompt.indexOf("{\n")));
  expect(parsed).toEqual({
    reviewedRevision: revision,
    comments: [
      {
        path: tricky.path,
        side: "old",
        line: 12,
        code: tricky.code,
        comment: tricky.body,
      },
    ],
  });
  expect(prompt).toContain("Old-side lines refer to reviewedBaseRevision");
  expect(() => formatReviewPrompt([], revision)).toThrow(
    "Add a review comment",
  );
  expect(() =>
    formatReviewPrompt([{ ...comment, body: " \n" }], revision),
  ).toThrow("Write a comment");
});

test("old-side review coordinates retain the diff base independently of the reviewed head", () => {
  const prompt = formatReviewPrompt(
    [{ ...comment, side: "old", line: 8 }],
    "reviewed-branch-head",
    "merge-base-from-earlier-history",
  );
  const parsed: unknown = JSON.parse(prompt.slice(prompt.indexOf("{\n")));
  expect(parsed).toMatchObject({
    reviewedRevision: "reviewed-branch-head",
    reviewedBaseRevision: "merge-base-from-earlier-history",
    comments: [{ path: comment.path, side: "old", line: 8 }],
  });
  expect(prompt).toContain("new-side lines refer to reviewedRevision");
  const withoutBase = formatReviewPrompt([comment], "reviewed-branch-head");
  const withoutBaseData: unknown = JSON.parse(
    withoutBase.slice(withoutBase.indexOf("{\n")),
  );
  expect(withoutBaseData).not.toHaveProperty("reviewedBaseRevision");
});

test("combined reviews respect the follow-up message limit without altering saved drafts", () => {
  const comments = Array.from({ length: 5 }, (_, index) => ({
    ...comment,
    id: `comment-${index}`,
    body: "x".repeat(4000),
    code: "y".repeat(2000),
  }));
  const savedDraft = JSON.stringify(comments);
  expect(parseReviewComments(savedDraft)).toEqual(comments);
  expect(
    formatReviewPrompt(comments.slice(0, 4), "reviewed-commit").length,
  ).toBeLessThanOrEqual(30_000);
  expect(() => formatReviewPrompt(comments, "reviewed-commit")).toThrow(
    "Shorten your comments or send them in smaller groups",
  );
  expect(JSON.stringify(comments)).toBe(savedDraft);

  const boundaryComments = comments.slice(0, 4);
  const revision = "revision";
  const available =
    30_000 - formatReviewPrompt(boundaryComments, revision).length;
  expect(
    formatReviewPrompt(boundaryComments, revision + "r".repeat(available)),
  ).toHaveLength(30_000);
  expect(() =>
    formatReviewPrompt(boundaryComments, revision + "r".repeat(available + 1)),
  ).toThrow("30,000-character message limit");
});
