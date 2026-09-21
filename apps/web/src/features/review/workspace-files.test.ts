import { expect, test } from "bun:test";
import { FileTree } from "@pierre/trees";
import {
  navigateWorkspaceTree,
  resetWorkspaceTree,
  workspaceGitStatus,
} from "@/features/review/workspace-files";

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

test("captured workspace changes distinguish new files from modified files using their diff", () => {
  const diff = `diff --git a/src/lifecycle.mjs b/src/lifecycle.mjs
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/lifecycle.mjs
@@ -0,0 +1 @@
+export const closeTicket = ticket => ({ ...ticket, status: "closed" });
diff --git a/README.md b/README.md
index 1111111..2222222 100644
--- a/README.md
+++ b/README.md
@@ -1 +1,2 @@
 # Queuecraft
+Now includes ticket lifecycle helpers.
diff --git a/empty.txt b/empty.txt
new file mode 100644
index 0000000..e69de29
diff --git a/icon.png b/icon.png
new file mode 100644
index 0000000..2222222
GIT binary patch
literal 1
Ic$QjO000310RR91
diff --git a/old.txt b/renamed.txt
similarity index 100%
rename from old.txt
rename to renamed.txt
`;
  const paths = [
    "src/lifecycle.mjs",
    "README.md",
    "empty.txt",
    "icon.png",
    "renamed.txt",
  ];
  expect(
    workspaceGitStatus(
      paths,
      paths.map((path) => ({ path, status: "changed" })),
      diff,
    ),
  ).toEqual([
    { path: "src/lifecycle.mjs", status: "added" },
    { path: "README.md", status: "modified" },
    { path: "empty.txt", status: "added" },
    { path: "icon.png", status: "added" },
    { path: "renamed.txt", status: "renamed" },
  ]);
});
