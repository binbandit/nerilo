"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FileTree, useFileTree, useFileTreeSearch } from "@pierre/trees/react";
import { Search, X } from "lucide-react";
import { matchesShortcut, type ShortcutAction } from "@nerilo/protocol";
import {
  useKeyboardBindings,
  useShortcutPlatform,
} from "@/features/navigation/shortcut-preferences";
import {
  navigateWorkspaceTree,
  resetWorkspaceTree,
  workspaceGitStatus,
} from "@/features/review/workspace-files";

const navigation: ShortcutAction[] = [
  "row-next",
  "row-previous",
  "row-first",
  "row-last",
  "row-expand",
  "row-collapse",
];
const nativeNavigation = new Set([
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
  "ArrowRight",
  "ArrowLeft",
]);

export function WorkspaceFileTree({
  files,
  changes,
  diff,
  selectedPath,
  onSelect,
  loading,
  failed,
}: {
  files: string[];
  changes: { path: string; status: string }[];
  diff: string;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  loading: boolean;
  failed: boolean;
}) {
  const [query, setQuery] = useState("");
  const [changedOnly, setChangedOnly] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const bindings = useKeyboardBindings();
  const mac = useShortcutPlatform();
  const latest = useRef({ onSelect, files: new Set(files) });
  const syncing = useRef(false);
  const revealedPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    latest.current = { onSelect, files: new Set(files) };
  }, [onSelect, files]);
  const { model } = useFileTree({
    paths: [],
    icons: "standard",
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    // The external input owns search; hide the built-in input and type-to-search.
    search: false,
    fileTreeSearchMode: "hide-non-matches",
    onSelectionChange: (paths) => {
      if (syncing.current) return;
      const path = paths.at(-1);
      if (path && latest.current.files.has(path)) latest.current.onSelect(path);
    },
  });
  const search = useFileTreeSearch(model);
  const paths = useMemo(() => {
    if (!changedOnly) return files;
    const changed = new Set(changes.map((change) => change.path));
    return files.filter((path) => changed.has(path));
  }, [files, changes, changedOnly]);
  useLayoutEffect(() => {
    syncing.current = true;
    try {
      resetWorkspaceTree(model, paths);
    } finally {
      syncing.current = false;
    }
  }, [model, paths]);
  useEffect(() => {
    model.setGitStatus(workspaceGitStatus(files, changes, diff));
  }, [model, files, changes, diff]);
  useLayoutEffect(() => {
    model.setSearch(query.trim() || null);
  }, [model, query, search.value]);
  useLayoutEffect(() => {
    syncing.current = true;
    try {
      for (const path of model.getSelectedPaths()) {
        if (path !== selectedPath) model.getItem(path)?.deselect();
      }
      if (selectedPath && paths.includes(selectedPath)) {
        model.getItem(selectedPath)?.select();
        if (revealedPath.current !== selectedPath) {
          model.scrollToPath(selectedPath, { focus: false });
          revealedPath.current = selectedPath;
        }
      }
    } finally {
      syncing.current = false;
    }
  }, [model, selectedPath, paths]);
  const focusTree = () => {
    const path =
      selectedPath && paths.includes(selectedPath) ? selectedPath : null;
    if (path && !query.trim()) model.scrollToPath(path, { focus: true });
    else model.focusFirstItem();
    // The model tracks focus, but crossing the shadow boundary needs DOM focus too.
    requestAnimationFrame(() => {
      model
        .getFileTreeContainer()
        ?.shadowRoot?.querySelector<HTMLElement>(
          '[role="treeitem"][tabindex="0"]',
        )
        ?.focus();
    });
  };
  return (
    <>
      <div className="workspace-file-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          autoFocus
          type="search"
          aria-label="Find a file"
          placeholder="Find a file…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape" && query) {
              event.preventDefault();
              event.stopPropagation();
              setQuery("");
            }
            if (
              (event.key.length > 1 ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey) &&
              matchesShortcut(event, "row-next", bindings, mac)
            ) {
              event.preventDefault();
              focusTree();
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear file search"
            onClick={() => {
              setQuery("");
              searchRef.current?.focus();
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
      <div className="workspace-file-filters" aria-label="Files to show">
        <button
          type="button"
          aria-pressed={!changedOnly}
          onClick={() => setChangedOnly(false)}
        >
          All files
        </button>
        <button
          type="button"
          aria-pressed={changedOnly}
          onClick={() => setChangedOnly(true)}
        >
          Changed
        </button>
      </div>
      <div
        className="workspace-file-tree"
        aria-busy={loading}
        onKeyDownCapture={(event) => {
          if (event.nativeEvent.isComposing) return;
          const action = navigation.find((action) =>
            matchesShortcut(event, action, bindings, mac),
          );
          if (action) {
            event.preventDefault();
            event.stopPropagation();
            navigateWorkspaceTree(model, action);
            const focused = model.getFocusedItem();
            if (focused && !focused.isDirectory()) onSelect(focused.getPath());
          } else if (
            nativeNavigation.has(event.key) &&
            !event.metaKey &&
            !event.ctrlKey &&
            !event.altKey
          ) {
            // A rebound or disabled shortcut must not fall through to Trees' defaults.
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <FileTree
          model={model}
          aria-label="Repository files"
          className="workspace-pierre-tree"
          style={{ width: "100%", height: "100%" }}
        />
        {!failed &&
          !loading &&
          (!paths.length || (query.trim() && !search.matchingPaths.length)) && (
            <p className="workspace-tree-empty">
              {query.trim()
                ? "No matching files."
                : changedOnly
                  ? "No changed files."
                  : "No files here."}
            </p>
          )}
        {loading && !files.length && (
          <p className="workspace-tree-empty" role="status">
            Loading files…
          </p>
        )}
      </div>
    </>
  );
}
