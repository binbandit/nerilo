import {
  FileTree,
  prepareFileTreeInput,
  type GitStatusEntry,
} from "@pierre/trees";
import { parseReviewDiff } from "@/features/review/diff-parser";

export function resetWorkspaceTree(model: FileTree, paths: string[]) {
  const folders = new Set<string>();
  for (const path of paths) {
    let slash = path.indexOf("/");
    while (slash !== -1) {
      folders.add(path.slice(0, slash + 1));
      slash = path.indexOf("/", slash + 1);
    }
  }
  const expanded = [...folders].filter((path) => {
    const item = model.getItem(path);
    return !item || ("isExpanded" in item && item.isExpanded());
  });
  model.resetPaths({
    preparedInput: prepareFileTreeInput(paths),
    initialExpandedPaths: expanded,
  });
}

export function navigateWorkspaceTree(model: FileTree, action: string) {
  const item = model.getFocusedItem();
  switch (action) {
    case "row-next":
      model.focusNextItem();
      break;
    case "row-previous":
      model.focusPreviousItem();
      break;
    case "row-first":
      model.focusFirstItem();
      break;
    case "row-last":
      model.focusLastItem();
      break;
    case "row-expand":
      if (item && "expand" in item && !item.isExpanded()) item.expand();
      else model.focusNextItem();
      break;
    case "row-collapse":
      if (item && "collapse" in item && item.isExpanded()) item.collapse();
      else model.focusParentItem();
      break;
  }
}

export function workspaceGitStatus(
  files: string[],
  changes: { path: string; status: string }[],
  diff = "",
): GitStatusEntry[] {
  const available = new Set(files);
  // Captured results use a generic "changed" status; the patch retains file identity.
  const captured = new Map<string, GitStatusEntry["status"]>(
    parseReviewDiff(diff).map((file) => [
      file.path,
      !file.oldPath
        ? "added"
        : !file.newPath
          ? "deleted"
          : file.oldPath !== file.newPath
            ? "renamed"
            : "modified",
    ]),
  );
  return changes
    .filter((change) => available.has(change.path))
    .map(({ path, status }) => ({
      path,
      status: status.startsWith("A")
        ? "added"
        : status.startsWith("D")
          ? "deleted"
          : status.startsWith("R")
            ? "renamed"
            : status === "??" || status === "?"
              ? "untracked"
              : status === "changed"
                ? (captured.get(path) ?? "modified")
                : "modified",
    }));
}
