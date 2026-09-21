"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  syntaxLimit,
  syntaxParts,
  type SyntaxSpan,
} from "@/features/review/syntax-spans";
import { highlightSource } from "@/features/review/syntax-worker";
import {
  hasSyntax,
  diffSyntaxLines,
  diffSyntaxSource,
} from "@/features/review/syntax-language";
import "@/features/review/code-text.css";

function useSyntax<T extends HTMLElement>(source: string, enabled = true) {
  const element = useRef<T>(null);
  const [result, setResult] = useState<{
    source: string;
    spans: SyntaxSpan[];
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let requested = false;
    const request = () => {
      if (requested) return;
      requested = true;
      let end = Math.min(source.length, syntaxLimit);
      if (
        end < source.length &&
        source.charCodeAt(end) >= 0xdc00 &&
        source.charCodeAt(end) <= 0xdfff
      )
        end--;
      void highlightSource(source.slice(0, end)).then((spans) => {
        if (!disposed && spans) setResult({ source, spans });
      });
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(
            (entries) => {
              if (entries.some((entry) => entry.isIntersecting)) {
                request();
                observer?.disconnect();
              }
            },
            { rootMargin: "200px" },
          );
    if (observer && element.current) observer.observe(element.current);
    else request();
    return () => {
      disposed = true;
      observer?.disconnect();
    };
  }, [source, enabled]);
  return {
    element,
    spans: enabled && result?.source === source ? result.spans : [],
  };
}

function Parts({
  source,
  spans,
  start = 0,
  end = source.length,
}: {
  source: string;
  spans: SyntaxSpan[];
  start?: number;
  end?: number;
}) {
  return syntaxParts(source, spans, start, end).map((part) => (
    <span
      key={part.start}
      className={part.type === "plain" ? undefined : `syntax-${part.type}`}
    >
      {part.text}
    </span>
  ));
}
export function CodeText({
  text,
  path,
  language,
}: {
  text: string;
  path?: string;
  language?: string;
}) {
  const { element, spans } = useSyntax<HTMLSpanElement>(
    text,
    hasSyntax({ path, language }),
  );
  return (
    <span
      ref={element}
      className="syntax-source"
      data-syntax={spans.length ? "webgpu" : "plain"}
    >
      <Parts source={text} spans={spans} />
    </span>
  );
}
function lineOffsets(lines: string[], separator = 0) {
  let offset = 0;
  return lines.map((text) => {
    const start = offset;
    offset += text.length + separator;
    return { text, start, end: start + text.length };
  });
}

export function HighlightedDiff({ text }: { text: string }) {
  const syntaxLines = diffSyntaxLines(text);
  const { element, spans } = useSyntax<HTMLPreElement>(
    diffSyntaxSource(text),
    syntaxLines.some(Boolean),
  );
  return (
    <pre
      tabIndex={0}
      aria-label="File changes"
      ref={element}
      className="syntax-source"
      data-syntax={spans.length ? "webgpu" : "plain"}
    >
      {lineOffsets(text.split(/(?<=\n)/)).map(
        ({ text: line, start, end }, index) => {
          const className =
            line.startsWith("+++") || line.startsWith("---")
              ? "diff-file"
              : line.startsWith("+")
                ? "diff-add"
                : line.startsWith("-")
                  ? "diff-remove"
                  : line.startsWith("@@")
                    ? "diff-hunk"
                    : undefined;
          return (
            <span key={start} className={className}>
              <span className="diff-number" aria-hidden="true">
                {index + 1}
              </span>
              <Parts
                source={text}
                spans={syntaxLines[index] ? spans : []}
                start={start}
                end={end}
              />
            </span>
          );
        },
      )}
    </pre>
  );
}

export function HighlightedLines({
  lines,
  path,
  renderLine,
}: {
  lines: string[];
  path: string;
  renderLine: (content: ReactNode, index: number) => ReactNode;
}) {
  const source = lines.join("\n");
  const { element, spans } = useSyntax<HTMLDivElement>(
    source,
    hasSyntax({ path }),
  );
  return (
    <div
      ref={element}
      className="syntax-source"
      data-syntax={spans.length ? "webgpu" : "plain"}
    >
      {lineOffsets(lines, 1).map(({ start, end }, index) => {
        return renderLine(
          <Parts source={source} spans={spans} start={start} end={end} />,
          index,
        );
      })}
    </div>
  );
}
