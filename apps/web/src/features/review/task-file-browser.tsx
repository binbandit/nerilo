"use client";
import { File, MessageSquarePlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useQuery } from "@tanstack/react-query";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { WorkspaceFileTree } from "@/features/review/workspace-file-tree";
import { CodeText } from "@/features/review/code-text";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import "@/features/review/task-file-browser.css";

const emptyFiles: string[] = [];

export function TaskFileBrowser({
  taskId,
  revision,
  changes,
  diff,
  selectedPath,
  onSelect,
  onReference,
}: {
  taskId: string;
  revision: string;
  changes: { path: string; status: string }[];
  diff: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onReference?: (path: string) => void;
}) {
  const { machineId, ready } = useSession();
  const listingQuery = useQuery({
    ...queries.files(machineId, taskId, revision),
    enabled: ready,
  });
  const previewQuery = useQuery({
    ...queries.file(machineId, taskId, revision, selectedPath ?? ""),
    enabled: ready && selectedPath !== null,
  });
  const listing = listingQuery.data;
  const preview = previewQuery.data;
  const loading = listingQuery.isFetching;
  const previewLoading = previewQuery.isPending;
  const error = listingQuery.error?.message ?? "";
  const previewError = previewQuery.error?.message ?? "";
  const refresh = () => {
    void listingQuery.refetch();
    if (selectedPath) void previewQuery.refetch();
  };
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
          onClick={refresh}
        />
      </div>
      <div className="workspace-browser-panes">
        <div className="workspace-browser-navigation">
          {error && (
            <div className="workspace-file-notice" role="alert">
              {error}
              <button type="button" onClick={refresh}>
                Try again
              </button>
            </div>
          )}
          <WorkspaceFileTree
            files={listing?.files ?? emptyFiles}
            changes={changes}
            diff={diff}
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
          aria-busy={previewQuery.isFetching}
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
              {previewError && preview && (
                <div className="workspace-file-notice" role="alert">
                  {previewError}{" "}
                  <button type="button" onClick={refresh}>
                    Try again
                  </button>
                </div>
              )}
              {previewLoading ? (
                <div className="workspace-preview-empty" role="status">
                  Loading file…
                </div>
              ) : previewError && !preview ? (
                <div className="workspace-preview-empty" role="alert">
                  <p>{previewError}</p>
                  <Button label="Try again" variant="ghost" onClick={refresh} />
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
