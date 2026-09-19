import { expect, test } from "bun:test";
import { FileTree } from "@pierre/trees";
import {
  navigateWorkspaceTree,
  resetWorkspaceTree,
  workspaceGitStatus,
} from "./workspace-files";

test("refreshing Pierre's tree preserves collapsed folders, selection, and search", () => {
  const tree = new FileTree({
    paths: [],
    initialExpansion: "closed",
    fileTreeSearchMode: "hide-non-matches",
  });
  try {
    resetWorkspaceTree(tree, ["src/main.ts", "docs/My Guide.md", "README.md"]);
    const folder = tree.getItem("src/");
    if (folder && "collapse" in folder) folder.collapse();
    tree.getItem("README.md")?.select();
    resetWorkspaceTree(tree, [
      "src/main.ts",
      "src/new.ts",
      "docs/My Guide.md",
      "README.md",
    ]);
    const refreshed = tree.getItem("src/");
    expect(
      refreshed && "isExpanded" in refreshed && refreshed.isExpanded(),
    ).toBe(false);
    expect(tree.getSelectedPaths()).toEqual(["README.md"]);
    tree.setSearch("Guide");
    expect(tree.getSearchMatchingPaths()).toEqual(["docs/My Guide.md"]);
    resetWorkspaceTree(tree, ["src/main.ts", "docs/My Guide.md", "README.md"]);
    expect(tree.getSearchValue()).toBe("guide");
    expect(tree.getSearchMatchingPaths()).toEqual(["docs/My Guide.md"]);
  } finally {
    tree.cleanUp();
  }
});

test("Nerilo row actions navigate and expand the library model", () => {
  const tree = new FileTree({
    paths: ["src/a.ts", "src/b.ts", "README.md"],
    initialExpansion: "closed",
  });
  try {
    navigateWorkspaceTree(tree, "row-first");
    expect(tree.getFocusedPath()).toBe("src/");
    navigateWorkspaceTree(tree, "row-expand");
    navigateWorkspaceTree(tree, "row-next");
    expect(tree.getFocusedPath()).toBe("src/a.ts");
    navigateWorkspaceTree(tree, "row-next");
    expect(tree.getFocusedPath()).toBe("src/b.ts");
    navigateWorkspaceTree(tree, "row-collapse");
    expect(tree.getFocusedPath()).toBe("src/");
    navigateWorkspaceTree(tree, "row-collapse");
    expect(tree.getVisibleCount()).toBe(2);
    navigateWorkspaceTree(tree, "row-last");
    expect(tree.getFocusedPath()).toBe("README.md");
    navigateWorkspaceTree(tree, "row-previous");
    expect(tree.getFocusedPath()).toBe("src/");
  } finally {
    tree.cleanUp();
  }
});

test("tree badges preserve Git statuses and omit files absent from the workspace", () => {
  expect(
    workspaceGitStatus(
      ["new.ts", "renamed.ts", "changed.ts"],
      [
        { path: "new.ts", status: "A" },
        { path: "renamed.ts", status: "R100" },
        { path: "changed.ts", status: "M" },
        { path: "removed.ts", status: "D" },
      ],
    ),
  ).toEqual([
    { path: "new.ts", status: "added" },
    { path: "renamed.ts", status: "renamed" },
    { path: "changed.ts", status: "modified" },
  ]);
});
