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

/** Track file boundaries so a mixed diff does not color prose as source code. */
export function diffSyntaxLines(text: string) {
  let enabled = false;
  return text.split(/(?<=\n)/).map((line) => {
    if (line.startsWith("diff --git ")) enabled = false;
    if (/^(---|\+\+\+) /.test(line)) {
      let path = line.slice(4).trimEnd();
      if (path.startsWith('"')) {
        try {
          path = JSON.parse(path) as string;
        } catch {
          path = "";
        }
      } else path = path.split("\t")[0];
      // A deletion's new path is /dev/null; retain the old file's language.
      if (path !== "/dev/null") enabled = hasSyntax({ path });
    }
    return enabled;
  });
}

/** Keep offsets intact while sending only code hunks to the lexer. */
export function diffSyntaxSource(text: string) {
  const enabled = diffSyntaxLines(text);
  let inHunk = false;
  return text
    .split(/(?<=\n)/)
    .map((line, index) => {
      if (line.startsWith("diff --git ") || /^(---|\+\+\+) /.test(line))
        inHunk = false;
      if (line.startsWith("@@")) inHunk = true;
      if (inHunk && enabled[index] && /^[ +\-]/.test(line))
        return " " + line.slice(1);
      return line.replace(/[^\r\n]/g, " ");
    })
    .join("");
}
