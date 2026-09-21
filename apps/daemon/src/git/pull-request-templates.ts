import type { PullRequestTemplate } from "@nerilo/protocol";
import { checked, command } from "../platform/config";

// Read Git objects, never filesystem paths: a template symlink must not expose
// files outside the checkout. Only committed templates belong to a PR.
export async function readPullRequestTemplates(
  path: string,
): Promise<PullRequestTemplate[]> {
  const tree = await checked(["git", "-C", path, "ls-tree", "-rz", "HEAD"]);
  const entries = tree
    .split("\0")
    .flatMap((entry) => {
      const match = /^(100644|100755) blob ([a-f0-9]+)\t(.+)$/.exec(entry);
      if (
        !match ||
        !/^(?:(?:\.github|docs)\/)?(?:pull_request_template(?:\.(?:md|markdown|txt))?|pull_request_template\/[^/]+\.(?:md|markdown|txt))$/i.test(
          match[3],
        )
      )
        return [];
      return [{ oid: match[2], path: match[3] }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const templates: PullRequestTemplate[] = [];
  for (const entry of entries) {
    const size = Number(
      await checked(["git", "-C", path, "cat-file", "-s", entry.oid]),
    );
    if (size > 240000) continue;
    // command preserves the template's leading/trailing whitespace.
    const result = await command([
      "git",
      "-C",
      path,
      "cat-file",
      "blob",
      entry.oid,
    ]);
    if (result.code)
      throw new Error("Could not read pull request templates. Try again.");
    if (result.stdout.length <= 60000)
      templates.push({ path: entry.path, body: result.stdout });
  }
  return templates;
}
