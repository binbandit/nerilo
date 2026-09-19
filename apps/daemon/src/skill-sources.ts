import { createHash } from "node:crypto";
import { z } from "zod";
import {
  parseAgentSkill,
  SKILL_BUNDLE_LIMIT,
  SKILL_FILE_LIMIT,
  skillFileSchema,
} from "@nerilo/protocol";
import {
  githubSkillDiscoverSchema,
  githubSkillDiscoverySchema,
  githubSkillImportSchema,
  githubSkillRepository,
} from "@nerilo/protocol";
import { command } from "./config";

type GithubRequest = (path: string) => Promise<unknown>;
const shaSchema = z.string().regex(/^[a-f0-9]{40}$/);
const commitSchema = z.object({
  sha: shaSchema,
  commit: z.object({ tree: z.object({ sha: shaSchema }) }),
});
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z
    .array(
      z.object({
        path: z.string(),
        mode: z.string(),
        type: z.string(),
        sha: shaSchema,
        size: z.number().int().nonnegative().optional(),
      }),
    )
    .max(100000),
});
const blobSchema = z.object({
  encoding: z.literal("base64"),
  content: z.string(),
  size: z.number().int().nonnegative(),
});

async function githubRequest(): Promise<GithubRequest> {
  let token: string | undefined;
  try {
    const auth = await command(
      ["gh", "auth", "token", "--hostname", "github.com"],
      { timeout: 5000 },
    );
    if (auth.code === 0) token = auth.stdout.trim() || undefined;
  } catch {
    /* Public repositories do not require a local GitHub login. */
  }
  return async (path) => {
    const response = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404)
        throw new Error(
          "Repository or revision not found. Check the name and your GitHub account's access.",
        );
      if ([401, 403, 429].includes(response.status))
        throw new Error(
          "GitHub access is unavailable or rate limited. Check your GitHub connection and try again.",
        );
      throw new Error(
        `GitHub could not load this skill (${response.status}). Try again shortly.`,
      );
    }
    if (!response.body) throw new Error("GitHub returned an empty response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 10 * 1024 * 1024)
          throw new Error(
            "This repository is too large to browse. Use a smaller skills repository or import a local folder.",
          );
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  };
}

async function repositoryTree(
  repository: string,
  ref: string,
  request: GithubRequest,
) {
  const commit = commitSchema.parse(
    await request(`repos/${repository}/commits/${encodeURIComponent(ref)}`),
  );
  const tree = treeSchema.parse(
    await request(
      `repos/${repository}/git/trees/${commit.commit.tree.sha}?recursive=1`,
    ),
  );
  if (tree.truncated)
    throw new Error(
      "GitHub returned only part of this repository. Use a smaller skills repository or import a local folder.",
    );
  return { revision: commit.sha, entries: tree.tree };
}

export async function discoverGithubSkills(
  input: unknown,
  request?: GithubRequest,
) {
  const selection = githubSkillDiscoverSchema.parse(input);
  const repository = githubSkillRepository(selection.url);
  const tree = await repositoryTree(
    repository,
    selection.ref ?? "HEAD",
    request ?? (await githubRequest()),
  );
  const skills = tree.entries
    .filter(
      (entry) =>
        entry.type === "blob" &&
        ["100644", "100755"].includes(entry.mode) &&
        (entry.path === "SKILL.md" || entry.path.endsWith("/SKILL.md")) &&
        !entry.path.split("/").includes(".git"),
    )
    .map((entry) => ({
      path: entry.path === "SKILL.md" ? "" : entry.path.slice(0, -9),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  if (skills.length > 200)
    throw new Error(
      "This repository contains more than 200 skills. Import a local skill folder instead.",
    );
  return githubSkillDiscoverySchema.parse({
    repository,
    revision: tree.revision,
    skills,
  });
}

export async function importGithubSkill(
  input: unknown,
  request?: GithubRequest,
) {
  const selection = githubSkillImportSchema.parse(input);
  const read = request ?? (await githubRequest());
  const tree = await repositoryTree(
    selection.repository,
    selection.revision,
    read,
  );
  if (tree.revision !== selection.revision)
    throw new Error(
      "The repository revision changed. Discover its skills again.",
    );
  const prefix = selection.path ? `${selection.path}/` : "";
  const entries = tree.entries.filter(
    (entry) => entry.path.startsWith(prefix) && entry.type !== "tree",
  );
  if (!entries.some((entry) => entry.path === `${prefix}SKILL.md`))
    throw new Error("This folder does not contain SKILL.md.");
  if (entries.length > 128)
    throw new Error(
      "A skill can contain at most 128 files. Choose a smaller skill folder.",
    );
  let total = 0;
  for (const entry of entries) {
    if (entry.type !== "blob" || !["100644", "100755"].includes(entry.mode))
      throw new Error(
        "Skill folders cannot contain symlinks or Git submodules. Import a folder containing regular files.",
      );
    skillFileSchema.parse({
      path: entry.path.slice(prefix.length),
      content: "",
    });
    if (entry.size === undefined || entry.size > SKILL_FILE_LIMIT)
      throw new Error("Each skill file must be 1 MB or smaller.");
    total += entry.size;
  }
  if (total > SKILL_BUNDLE_LIMIT)
    throw new Error("A skill must be 4 MB or smaller.");
  const files: z.infer<typeof skillFileSchema>[] = [];
  // Small batches keep GitHub requests bounded while preserving binary assets.
  for (let offset = 0; offset < entries.length; offset += 4) {
    files.push(
      ...(await Promise.all(
        entries.slice(offset, offset + 4).map(async (entry) => {
          const blob = blobSchema.parse(
            await read(`repos/${selection.repository}/git/blobs/${entry.sha}`),
          );
          const content = blob.content.replace(/\s/g, "");
          const bytes = Buffer.from(content, "base64");
          if (
            bytes.toString("base64") !== content ||
            bytes.length !== entry.size ||
            blob.size !== entry.size
          )
            throw new Error(
              "GitHub returned an incomplete skill file. Try importing again.",
            );
          const hash = createHash("sha1")
            .update(`blob ${bytes.length}\0`)
            .update(bytes)
            .digest("hex");
          if (hash !== entry.sha)
            throw new Error(
              "GitHub returned a skill file that does not match the selected revision.",
            );
          const path = entry.path.slice(prefix.length);
          if (path === "SKILL.md") {
            let text: string;
            try {
              text = new TextDecoder("utf-8", {
                fatal: true,
                ignoreBOM: true,
              }).decode(bytes);
            } catch {
              throw new Error("SKILL.md must be a UTF-8 text file.");
            }
            return { path, content: text, encoding: "utf8" as const };
          }
          return { path, content, encoding: "base64" as const };
        }),
      )),
    );
  }
  return parseAgentSkill({
    id: crypto.randomUUID(),
    enabled: true,
    files,
    source: selection,
  });
}
