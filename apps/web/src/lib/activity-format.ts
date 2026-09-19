/** Decode one complete shell word, including adjacent quoted segments. Never evaluate it. */
function shellCommand(command: string, stopAtNewline = false) {
  const match =
    /^(?:(?:\/usr)?\/bin\/)?(?:bash|sh|zsh)\s+-(?:lc|cl|c)\s+([\s\S]+)$/.exec(
      command,
    );
  if (!match || !['"', "'"].includes(match[1][0])) return null;
  const word = match[1];
  let quote: "single" | "double" | null = null;
  let result = "";
  for (let index = 0; index < word.length; index++) {
    const char = word[index];
    if (quote === "single") {
      if (char === "'") quote = null;
      else result += char;
      continue;
    }
    if (char === '"') {
      quote = quote === "double" ? null : "double";
      continue;
    }
    if (quote === null && char === "'") {
      quote = "single";
      continue;
    }
    if (char === "\\") {
      const next = word[index + 1];
      if (next === undefined) return null;
      if (quote === null || '\\"$`\n'.includes(next)) {
        result += next === "\n" ? "" : next;
        index++;
        continue;
      }
    }
    if (stopAtNewline && quote === null && char === "\n")
      return { text: result, length: command.length - word.length + index };
    // Outside quotes these can start another argument, expansion or shell operation.
    if (quote === null && /[\s;&|<>()$`*?\[\]{}]/.test(char)) return null;
    result += char;
  }
  return quote === null ? { text: result, length: command.length } : null;
}

export function readableCommand(command: string): string {
  return shellCommand(command)?.text ?? command;
}

/** Render terminal text as text, removing control sequences rather than interpreting HTML. */
export function terminalText(value: string): string {
  return value
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][0-2A-Z]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, "");
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function activityPresentation(text: string) {
  const firstLine = text.split("\n")[0];
  const parsedCommand = shellCommand(text, true);
  if (parsedCommand) {
    const command = parsedCommand.text;
    return {
      label: "Terminal",
      detail: command,
      command,
      output: text.slice(parsedCommand.length + 1),
      kind: "command" as const,
    };
  }
  try {
    const value: unknown = JSON.parse(text);
    if (
      record(value) &&
      value.type === "file_change" &&
      Array.isArray(value.changes)
    ) {
      const paths = value.changes.flatMap((change: unknown) =>
        record(change) && typeof change.path === "string"
          ? [change.path.replace(/^\/work\/repo\//, "")]
          : [],
      );
      if (paths.length)
        return {
          label: "Edited",
          detail: paths.join(", "),
          command: null,
          output: paths.join("\n"),
          kind: "files" as const,
        };
    }
  } catch {
    // Provider events also include ordinary text and command output.
  }
  const tool = /^([A-Za-z_][\w.]*) (\{[\s\S]*\})$/.exec(text);
  if (tool) {
    try {
      const input: unknown = JSON.parse(tool[2]);
      if (record(input)) {
        if (tool[1] === "Bash" && typeof input.command === "string") {
          return {
            label: "Terminal",
            detail:
              typeof input.description === "string"
                ? input.description
                : readableCommand(input.command),
            command: readableCommand(input.command),
            output: "",
            kind: "command" as const,
          };
        }
        const path =
          typeof input.file_path === "string"
            ? input.file_path.replace(/^\/work\/repo\//, "")
            : "";
        return {
          label: tool[1],
          detail: path,
          command: null,
          output: JSON.stringify(input, null, 2),
          kind: "text" as const,
        };
      }
    } catch {
      // Keep unrecognized events readable without guessing their structure.
    }
  }
  return {
    label: terminalText(firstLine),
    detail: "",
    command: null,
    output: text,
    kind:
      !text.includes("\n") && !/^[\[{]/.test(text.trim())
        ? ("notice" as const)
        : ("text" as const),
  };
}
