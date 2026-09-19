# Agent skills

Settings → Skills lets you import a `SKILL.md`, import a folder with supporting files, or write a skill directly. The editor reads the name and description from YAML frontmatter. Import one skill folder at a time, with `SKILL.md` directly inside it. Imported files are stored locally as a copy; subsequent edits to the original folder are not synchronized.

Enabled skills are supplied to Codex and Claude Code on the next turn, including follow-ups. Editing or disabling a skill does not interrupt a running turn. Disabling removes future discovery and the installed files; instructions already read into conversation history remain in that history. Skills are available across tasks by default. The task composer’s Tools picker can select a smaller set for an individual task; selections apply on its next turn. Nerilo does not automatically import the host's skills.

## Import from GitHub

Choose **Add skill → GitHub…** in Settings → Skills, enter an `owner/repository` or `https://github.com/owner/repository` URL, and optionally specify a branch or tag. Nerilo lists folders containing `SKILL.md` without downloading every skill. Select one to review its manifest and supporting files before saving it.

Discovery pins the repository to a commit. The imported copy records that commit and its original folder; it does not automatically update when the branch moves. Importing reads GitHub files without cloning a checkout or running repository hooks or scripts. Binary assets are preserved. Symlinks, Git submodules, oversized bundles and incomplete repository listings are rejected.

Public repositories work without signing in. Private repositories use the existing local GitHub CLI account and its repository access. Repository URLs must use github.com; GitHub Enterprise URLs and interactive repository sign-in are not supported by this importer. For a skill available only on another host, import its local folder instead.

The importer uses GitHub’s read-only [tree](https://docs.github.com/en/rest/git/trees#get-a-tree) and [blob](https://docs.github.com/en/rest/git/blobs#get-a-blob) APIs. It browses at most 200 skills per repository and retains the same file and bundle limits as local imports.

## Format

Skills use the [Agent Skills format](https://agentskills.io/specification). `SKILL.md` requires `name` and `description` in YAML frontmatter; other provider-specific fields are preserved. Names use lowercase letters, numbers and single hyphens, up to 64 characters. Supporting scripts, references and binary assets retain their relative paths. The editor can change the manifest while preserving those resources, or replace the entire bundle by importing a folder again.

Limits are 32 skills, 128 files per skill, 1 MB per file, 4 MB per skill and 16 MB total. Unsafe paths, duplicate names, malformed manifests and conflicting file paths are rejected before saving.

## Environment

Each turn receives its enabled skill bundles in temporary storage outside the repository. Codex discovers them through its native admin skill directory; Claude loads them through an isolated Nerilo plugin, with names such as `nerilo:review-guide`. Providers decide when to load a skill based on the task and its description. Mentioning the skill by name can help select it.

Skill files are removed before verification and during failure cleanup. They do not appear in Git changes. Title and summary generation do not receive them. Skills follow existing sandbox permissions and do not install dependencies or expand network access. The temporary filesystem prevents direct executable launches, so run bundled scripts through an interpreter such as `bash`, `python3` or `node`.

Provider references: [Codex skill discovery](https://learn.chatgpt.com/docs/build-skills), [Claude plugin skills](https://code.claude.com/docs/en/plugins).
