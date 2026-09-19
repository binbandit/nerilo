"use client";
import { useEffect, useState } from "react";
import { File, MessageSquarePlus, RefreshCw } from "lucide-react";
import { workspaceFilesSchema, workspaceFileSchema } from "@nerilo/protocol";
import { Button } from "@/components/ui";
import { read } from "@/lib/api";
import { WorkspaceFileTree } from "@/components/workspace-file-tree";
import { CodeText } from "@/components/code-text";
import { CopyTextButton } from "@/components/copy-text-button";
import "./task-file-browser.css";

const emptyFiles: string[] = [];

export function TaskFileBrowser({
  taskId,
  revision,
  changes,
  selectedPath,
  onSelect,
  onReference,
}: {
  taskId: string;
  revision: string;
  changes: { path: string; status: string }[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onReference?: (path: string) => void;
}) {
  const [listing, setListing] = useState<{
    files: string[];
    truncated: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<{
    path: string;
    content: string;
    image: string | null;
  } | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    void read(`tasks/${taskId}/files`)
      .then((response) => {
        if (!cancelled) setListing(workspaceFilesSchema.parse(response));
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(
            reason instanceof Error ? reason.message : "Could not load files.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, revision, refresh]);
  useEffect(() => {
    let cancelled = false;
    setPreview(null);
    setPreviewError("");
    if (!selectedPath) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    void read(`tasks/${taskId}/file?path=${encodeURIComponent(selectedPath)}`)
      .then((response) => {
        if (!cancelled) setPreview(workspaceFileSchema.parse(response));
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setPreviewError(
            reason instanceof Error ? reason.message : "Could not open file.",
          );
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, selectedPath, revision, refresh]);
  const lineCount = preview?.content
    ? preview.content.split("\n").length -
      Number(preview.content.endsWith("\n"))
    : 0;
  return (
    <div className="workspace-browser">
      <div className="workspace-browser-toolbar">
        <span className="workspace-browser-title">Files</span>
        <Button
          label="Refresh files"
          icon={<RefreshCw size={15} />}
          isIconOnly
          variant="ghost"
          size="sm"
          isLoading={loading}
          onClick={() => setRefresh((value) => value + 1)}
        />
      </div>
      <div className="workspace-browser-panes">
        <div className="workspace-browser-navigation">
          {error && (
            <div className="workspace-file-notice" role="alert">
              {error}
              <button
                type="button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          )}
          <WorkspaceFileTree
            files={listing?.files ?? emptyFiles}
            changes={changes}
            selectedPath={selectedPath}
            onSelect={onSelect}
            loading={loading}
            failed={Boolean(error)}
          />
          {listing?.truncated && (
            <p className="workspace-file-notice">
              Showing the first {listing.files.length.toLocaleString()} files.
            </p>
          )}
        </div>
        <section
          className="workspace-file-preview"
          aria-label="File preview"
          aria-busy={previewLoading}
        >
          {selectedPath ? (
            <>
              <header className="workspace-preview-header">
                <span title={selectedPath}>{selectedPath}</span>
                <CopyTextButton text={selectedPath} label="Copy file path" />
                {onReference && (
                  <Button
                    label="Add file to follow-up"
                    icon={<MessageSquarePlus size={15} />}
                    isIconOnly
                    variant="ghost"
                    size="sm"
                    onClick={() => onReference(selectedPath)}
                  />
                )}
              </header>
              {previewLoading ? (
                <div className="workspace-preview-empty" role="status">
                  Loading file…
                </div>
              ) : previewError ? (
                <div className="workspace-preview-empty" role="alert">
                  <p>{previewError}</p>
                  <Button
                    label="Try again"
                    variant="ghost"
                    onClick={() => setRefresh((value) => value + 1)}
                  />
                </div>
              ) : preview ? (
                <>
                  <div className="workspace-preview-content">
                    {preview.image ? (
                      <img src={preview.image} alt={preview.path} />
                    ) : (
                      <pre tabIndex={0} aria-label="File contents">
                        <CodeText text={preview.content} path={preview.path} />
                      </pre>
                    )}
                  </div>
                  <footer className="workspace-preview-footer">
                    <span>
                      {preview.image
                        ? "Image"
                        : preview.content === ""
                          ? "Empty file"
                          : `${lineCount.toLocaleString()} ${lineCount === 1 ? "line" : "lines"}`}
                    </span>
                    {!preview.image && (
                      <CopyTextButton
                        text={preview.content}
                        label="Copy file contents"
                      />
                    )}
                  </footer>
                </>
              ) : null}
            </>
          ) : (
            <div className="workspace-preview-empty">
              <File size={24} />
              <p>Select a file to preview</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
