export type ReviewLine = {
  id: string;
  kind: "context" | "add" | "remove" | "meta";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type ReviewFile = {
  id: string;
  path: string;
  oldPath: string | null;
  newPath: string | null;
  lines: ReviewLine[];
  binary: boolean;
};

export type ReviewComment = {
  id: string;
  fileId: string;
  path: string;
  side: "old" | "new";
  line: number;
  code: string;
  body: string;
};

// Git quotes unusual paths as bytes, including octal-escaped UTF-8 sequences.
function readQuotedPath(
  value: string,
): { path: string; length: number } | null {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '"': 34,
    "\\": 92,
  };
  for (let index = 1; index < value.length; index++) {
    const character = value[index]!;
    if (character === '"') {
      try {
        return {
          path: new TextDecoder("utf-8", { fatal: true }).decode(
            new Uint8Array(bytes),
          ),
          length: index + 1,
        };
      } catch {
        return null;
      }
    }
    if (character !== "\\") {
      const point = String.fromCodePoint(value.codePointAt(index)!);
      bytes.push(...encoder.encode(point));
      index += point.length - 1;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(value.slice(index + 1));
    if (octal) {
      const byte = Number.parseInt(octal[0], 8);
      if (byte > 255) return null;
      bytes.push(byte);
      index += octal[0].length;
    } else {
      const escaped = escapes[value[++index]!];
      if (escaped === undefined) return null;
      bytes.push(escaped);
    }
  }
  return null;
}

export function readGitPath(value: string, prefix = false): string | null {
  const quoted = value.startsWith('"') ? readQuotedPath(value) : null;
  if (value.startsWith('"') && !quoted) return null;
  if (
    quoted &&
    value.slice(quoted.length) !== "" &&
    !value.slice(quoted.length).startsWith("\t")
  )
    return null;
  const path = quoted?.path ?? value.split("\t")[0]!;
  if (!path || path === "/dev/null" || path.includes("\0")) return null;
  return prefix && /^[ab]\//.test(path) ? path.slice(2) : path;
}

function headerPaths(value: string): [string | null, string | null] {
  if (value.startsWith('"')) {
    const quoted = readQuotedPath(value);
    if (!quoted || value[quoted.length] !== " ") return [null, null];
    return [
      readGitPath(value.slice(0, quoted.length), true),
      readGitPath(value.slice(quoted.length + 1), true),
    ];
  }
  // Unquoted Git paths can contain spaces. File/rename headers refine these.
  const separators = [...value.matchAll(/ b\//g)].map(({ index }) => index);
  const separator =
    separators.find(
      (index) => value.slice(2, index) === value.slice(index + 3),
    ) ??
    separators[0] ??
    -1;
  const quotedSeparator = value.indexOf(' "b/');
  const split = separator >= 0 ? separator : quotedSeparator;
  if (split < 0) return [null, null];
  return [
    readGitPath(value.slice(0, split), true),
    readGitPath(value.slice(split + 1), true),
  ];
}

type Hunk = {
  start: number;
  oldLine: number;
  newLine: number;
  oldRemaining: number;
  newRemaining: number;
  invalid: boolean;
};

export function parseReviewDiff(text: string): ReviewFile[] {
  const files: ReviewFile[] = [];
  let file: ReviewFile | undefined;
  let hunk: Hunk | undefined;
  let seenHunk = false;
  const append = (
    text: string,
    kind: ReviewLine["kind"] = "meta",
    oldLine: number | null = null,
    newLine: number | null = null,
  ) => {
    if (!file) return;
    file.lines.push({
      id: `${file.id}:${file.lines.length}`,
      kind,
      text,
      oldLine,
      newLine,
    });
  };
  const finishHunk = () => {
    if (
      file &&
      hunk &&
      (hunk.invalid || hunk.oldRemaining !== 0 || hunk.newRemaining !== 0)
    ) {
      for (const line of file.lines.slice(hunk.start)) {
        line.kind = "meta";
        line.oldLine = null;
        line.newLine = null;
      }
    }
    hunk = undefined;
  };
  const rows = text.split("\n");
  if (rows.at(-1) === "") rows.pop();
  for (const row of rows) {
    if (row.startsWith("diff --git ")) {
      finishHunk();
      const [oldPath, newPath] = headerPaths(row.slice(11));
      file = {
        id: `file:${files.length}`,
        path: newPath ?? oldPath ?? "Unknown file",
        oldPath,
        newPath,
        lines: [],
        binary: false,
      };
      files.push(file);
      seenHunk = false;
      continue;
    }
    if (!file) continue;
    if (row.startsWith("@@")) {
      finishHunk();
      seenHunk = true;
      const match =
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: [\s\S]*)?$/.exec(row);
      const [oldLine, oldCount, newLine, newCount] = match
        ? [
            Number(match[1]),
            Number(match[2] ?? 1),
            Number(match[3]),
            Number(match[4] ?? 1),
          ]
        : [0, 0, 0, 0];
      hunk = {
        start: file.lines.length,
        oldLine: oldLine!,
        newLine: newLine!,
        oldRemaining: oldCount!,
        newRemaining: newCount!,
        invalid:
          !match ||
          ![
            oldLine,
            oldCount,
            newLine,
            newCount,
            oldLine! + oldCount!,
            newLine! + newCount!,
          ].every(Number.isSafeInteger) ||
          (oldCount! > 0 && oldLine === 0) ||
          (newCount! > 0 && newLine === 0),
      };
      append(row);
      continue;
    }
    if (row === "\\ No newline at end of file") {
      append(row);
      continue;
    }
    if (hunk) {
      const prefix = row[0];
      const consumesOld = prefix === " " || prefix === "-";
      const consumesNew = prefix === " " || prefix === "+";
      if (
        (!consumesOld && !consumesNew) ||
        (consumesOld && hunk.oldRemaining <= 0) ||
        (consumesNew && hunk.newRemaining <= 0)
      ) {
        hunk.invalid = true;
        append(row);
      } else {
        append(
          row,
          prefix === "+" ? "add" : prefix === "-" ? "remove" : "context",
          consumesOld ? hunk.oldLine++ : null,
          consumesNew ? hunk.newLine++ : null,
        );
        if (consumesOld) hunk.oldRemaining--;
        if (consumesNew) hunk.newRemaining--;
      }
      continue;
    }
    if (!seenHunk && row.startsWith("--- "))
      file.oldPath = readGitPath(row.slice(4), true);
    else if (!seenHunk && row.startsWith("+++ "))
      file.newPath = readGitPath(row.slice(4), true);
    else if (!seenHunk && row.startsWith("rename from "))
      file.oldPath = readGitPath(row.slice(12));
    else if (!seenHunk && row.startsWith("rename to "))
      file.newPath = readGitPath(row.slice(10));
    else if (row.startsWith("new file mode ")) file.oldPath = null;
    else if (row.startsWith("deleted file mode ")) file.newPath = null;
    else if (row.startsWith("Binary files ") || row === "GIT binary patch") {
      file.binary = true;
      append(row);
    } else if (
      !row.startsWith("index ") &&
      !row.startsWith("similarity index ")
    )
      append(row);
  }
  finishHunk();
  for (const entry of files) {
    entry.path = entry.newPath ?? entry.oldPath ?? "Unknown file";
    for (const line of entry.lines) {
      if (
        (line.oldLine !== null && !entry.oldPath) ||
        (line.newLine !== null && !entry.newPath)
      ) {
        line.kind = "meta";
        line.oldLine = null;
        line.newLine = null;
      }
    }
  }
  return files;
}

function boundedString(
  value: unknown,
  maximum: number,
  nonempty = true,
): value is string {
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    (!nonempty || value.trim().length > 0)
  );
}

export function parseReviewComments(raw: string): ReviewComment[] {
  if (raw.length > 1_000_000) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length > 50) return [];
    const ids = new Set<string>();
    const comments: ReviewComment[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry))
        return [];
      const value: Record<string, unknown> = entry;
      if (
        !boundedString(value.id, 200) ||
        ids.has(value.id) ||
        !boundedString(value.fileId, 200) ||
        !boundedString(value.path, 4096) ||
        value.path.includes("\0") ||
        (value.side !== "old" && value.side !== "new") ||
        typeof value.line !== "number" ||
        !Number.isSafeInteger(value.line) ||
        value.line < 1 ||
        !boundedString(value.code, 2000, false) ||
        !boundedString(value.body, 4000, false)
      )
        return [];
      ids.add(value.id);
      comments.push({
        id: value.id,
        fileId: value.fileId,
        path: value.path,
        side: value.side,
        line: value.line,
        code: value.code,
        body: value.body,
      });
    }
    return comments;
  } catch {
    return [];
  }
}

export function formatReviewPrompt(
  comments: ReviewComment[],
  revision: string,
  baseRevision?: string,
): string {
  if (comments.length === 0)
    throw new Error("Add a review comment before sending.");
  if (comments.some(({ body }) => !body.trim()))
    throw new Error("Write a comment for each selected line before sending.");
  const prompt = [
    "Please address this review of the task's changes. Check the current files before editing because the workspace may have changed since the review.",
    "The JSON below records the reviewed revision and each comment's exact path, diff side, line, code, and requested change. Old-side lines refer to reviewedBaseRevision when provided, otherwise the base version of the reviewed diff; new-side lines refer to reviewedRevision.",
    JSON.stringify(
      {
        reviewedRevision: revision,
        ...(baseRevision === undefined
          ? {}
          : { reviewedBaseRevision: baseRevision }),
        comments: comments.map(({ path, side, line, code, body }) => ({
          path,
          side,
          line,
          code,
          comment: body,
        })),
      },
      null,
      2,
    ),
  ].join("\n\n");
  if (prompt.length > 30_000)
    throw new Error(
      "This review exceeds the 30,000-character message limit. Shorten your comments or send them in smaller groups.",
    );
  return prompt;
}
