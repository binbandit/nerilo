"use client";

import { type ComponentProps, createContext, memo, useContext } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeText } from "@/features/review/code-text";

const OpenFileContext = createContext<((path: string) => void) | null>(null);
const remarkPlugins = [remarkGfm];
const disallowedElements = ["img"];

function MarkdownLink({ children, href }: ComponentProps<"a">) {
  const openFile = useContext(OpenFileContext);
  if (openFile && href?.startsWith("/work/repo/")) {
    // react-markdown percent-encodes hrefs; drop #L12-L20 anchors first so an
    // encoded "#" in a file name survives decoding.
    const raw = href.slice(11).replace(/#L\d+(?:-L\d+)?$/, "");
    let path = raw;
    try {
      path = decodeURIComponent(raw);
    } catch {}
    path = path.replace(/:\d+(?::\d+)?$/, "");
    return (
      <button className="inline-file-link" onClick={() => openFile(path)}>
        {children}
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

// Stable component identities preserve code highlighting and DOM state on refresh.
const components: Components = {
  a: MarkdownLink,
  pre: ({ children }) => (
    <pre tabIndex={0} aria-label="Code block">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={className}>
      <CodeText
        text={String(children ?? "")}
        language={className?.match(/language-([^\s]+)/)?.[1]}
      />
    </code>
  ),
};

export const TaskMarkdown = memo(function TaskMarkdown({
  text,
  onOpenFile,
}: {
  text: string;
  onOpenFile: (path: string) => void;
}) {
  return (
    <OpenFileContext value={onOpenFile}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        disallowedElements={disallowedElements}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </OpenFileContext>
  );
});
