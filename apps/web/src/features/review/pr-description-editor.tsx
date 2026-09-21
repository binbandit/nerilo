"use client";

import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { Button } from "@/components/ui/ui";
import "./pr-description-editor.css";

const remarkPlugins = [remarkGfm];

export function PRDescriptionEditor({
  taskId,
  head,
  value,
  onChange,
  disabled,
}: {
  taskId: string;
  head: string;
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const id = useId();
  const { machineId } = useSession();
  const templates = useQuery(queries.gitTemplates(machineId, taskId, head));
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [selected, setSelected] = useState("");
  const [confirm, setConfirm] = useState(false);
  const template = templates.data?.find((item) => item.path === selected);

  function applyTemplate() {
    if (!template) return;
    onChange(template.body);
    setConfirm(false);
    setMode("write");
  }

  return (
    <section className="pr-description" aria-labelledby={id + "-label"}>
      <label id={id + "-label"} htmlFor={id + "-input"}>
        Description
      </label>
      <div className="pr-template-controls">
        {templates.isPending ? (
          <span role="status">Loading templates…</span>
        ) : templates.isError ? (
          <>
            <span role="status">Could not load repository templates.</span>
            <Button
              label="Retry"
              size="sm"
              variant="ghost"
              onClick={() => void templates.refetch()}
            />
          </>
        ) : templates.data.length ? (
          <>
            <select
              aria-label="Pull request template"
              value={selected}
              disabled={disabled}
              onChange={(event) => {
                setSelected(event.target.value);
                setConfirm(false);
              }}
            >
              <option value="">Choose a repository template…</option>
              {templates.data.map((item) => (
                <option key={item.path} value={item.path}>
                  {item.path}
                </option>
              ))}
            </select>
            <Button
              label="Use template"
              size="sm"
              variant="ghost"
              isDisabled={disabled || !template}
              onClick={() => {
                if (value.trim()) setConfirm(true);
                else applyTemplate();
              }}
            />
          </>
        ) : (
          <span>No PR templates in this checkout.</span>
        )}
      </div>
      {confirm && template && (
        <div
          className="pr-template-confirm"
          role="group"
          aria-label="Replace description"
        >
          <span>Replace your description with this template?</span>
          <Button
            label="Replace description"
            size="sm"
            isDisabled={disabled}
            onClick={applyTemplate}
          />
          <Button
            label="Cancel"
            size="sm"
            variant="ghost"
            onClick={() => setConfirm(false)}
          />
        </div>
      )}
      <div className="pr-markdown-editor">
        <div
          className="pr-editor-toolbar"
          role="group"
          aria-label="Description view"
        >
          <button
            type="button"
            aria-pressed={mode === "write"}
            onClick={() => setMode("write")}
          >
            Write
          </button>
          <button
            type="button"
            aria-pressed={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            Preview
          </button>
          <span>Markdown supported</span>
        </div>
        <textarea
          id={id + "-input"}
          aria-labelledby={id + "-label"}
          aria-describedby={id + "-count"}
          hidden={mode !== "write"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          maxLength={60000}
          placeholder="Describe the changes, why they matter, and how you tested them…"
          spellCheck
        />
        {mode === "preview" && (
          <div
            className="pr-markdown-preview"
            aria-label="Description preview"
            tabIndex={0}
          >
            {value.trim() ? (
              <ReactMarkdown
                remarkPlugins={remarkPlugins}
                skipHtml
                components={{
                  a: ({ children, href }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {value}
              </ReactMarkdown>
            ) : (
              <p className="task-git-muted">Nothing to preview yet.</p>
            )}
          </div>
        )}
      </div>
      <span className="pr-description-count" id={id + "-count"}>
        {value.length.toLocaleString()} / 60,000 characters
      </span>
    </section>
  );
}
