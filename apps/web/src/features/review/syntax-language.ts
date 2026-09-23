import { readGitPath } from "@/features/review/diff-parser";

const languages = new Set([
  "js",
  "javascript",
  "jsx",
  "ts",
  "typescript",
  "tsx",
  "json",
  "jsonc",
  "html",
  "xml",
  "svg",
  "css",
  "scss",
  "sass",
  "less",
  "yaml",
  "yml",
  "toml",
  "ini",
  "py",
  "python",
  "rb",
  "ruby",
  "go",
  "rs",
  "rust",
  "c",
  "h",
  "cpp",
  "cxx",
  "hpp",
  "cc",
  "c++",
  "cs",
  "csharp",
  "java",
  "kt",
  "kotlin",
  "swift",
  "php",
  "sh",
  "shell",
  "bash",
  "zsh",
  "fish",
  "sql",
  "graphql",
  "gql",
  "dockerfile",
  "makefile",
  "lua",
  "r",
  "dart",
  "vue",
  "svelte",
  "mjs",
  "cjs",
  "mts",
  "cts",
  "ex",
  "exs",
  "elixir",
]);

export function hasSyntax({
  path,
  language,
}: {
  path?: string;
  language?: string;
}) {
  if (path !== undefined) {
    const name = path.split("/").at(-1)?.toLowerCase() ?? "";
    if (/\.(txt|text|log|md|rst)$/i.test(name)) return false;
    if (
      name === "dockerfile" ||
      name.startsWith("dockerfile.") ||
      name === "makefile"
    )
      return true;
    if (name === ".env" || name.startsWith(".env.")) return true;
    return languages.has(name.includes(".") ? name.split(".").at(-1)! : "");
  }
  return languages.has(language?.toLowerCase() ?? "");
}

/**
 * Mark hunk content lines using each hunk header's counts, so content such as
 * a removed `-- comment` is not mistaken for a `---` file header.
 */
export function diffHunkLines(text: string) {
  let oldRemaining = 0;
  let newRemaining = 0;
  return text.split(/(?<=\n)/).map((line) => {
    if (oldRemaining > 0 || newRemaining > 0) {
      const prefix = line[0];
      if (prefix === "\\") return true;
      if (prefix === " " || prefix === "-" || prefix === "+") {
        if (prefix !== "+") oldRemaining--;
        if (prefix !== "-") newRemaining--;
        return true;
      }
      oldRemaining = newRemaining = 0;
    }
    const hunk = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      oldRemaining = Number(hunk[1] ?? 1);
      newRemaining = Number(hunk[2] ?? 1);
    }
    return false;
  });
}

/** Track file boundaries so a mixed diff does not color prose as source code. */
export function diffSyntaxLines(text: string) {
  const hunks = diffHunkLines(text);
  let enabled = false;
  return text.split(/(?<=\n)/).map((line, index) => {
    if (hunks[index]) return enabled;
    if (line.startsWith("diff --git ")) enabled = false;
    if (/^(---|\+\+\+) /.test(line)) {
      const path = line.slice(4).trimEnd();
      // A deletion's new path is /dev/null; retain the old file's language.
      if (path.split("\t")[0] !== "/dev/null")
        enabled = hasSyntax({ path: readGitPath(path) ?? "" });
    }
    return enabled;
  });
}

/** Keep offsets intact while sending only code hunks to the lexer. */
export function diffSyntaxSource(text: string) {
  const enabled = diffSyntaxLines(text);
  const hunks = diffHunkLines(text);
  return text
    .split(/(?<=\n)/)
    .map((line, index) => {
      if (hunks[index] && enabled[index] && /^[ +\-]/.test(line))
        return " " + line.slice(1);
      return line.replace(/[^\r\n]/g, " ");
    })
    .join("");
}
