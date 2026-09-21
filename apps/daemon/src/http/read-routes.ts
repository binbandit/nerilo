import {
  providerSchema,
  pullRequestListStateSchema,
  githubAccountBindingSchema,
} from "@nerilo/protocol";
import { withGithubAccount } from "../git/github-context";
import { readPullRequestContext } from "../git/pull-request-context";
import { githubAccounts } from "../git/github-accounts";
import { gatewayView } from "../agents/gateway";
import { modelCatalog } from "../agents/models";
import {
  gitRemoteStatus,
  gitStatus,
  gitPullRequestTemplates,
} from "../git/git-workflows";
import { listProjectPullRequests } from "../git/pull-requests";
import { dataDir } from "../platform/config";
import { readMachineIdentity } from "../platform/machine-identity";
import { FolderError, listFolders } from "../projects/folders";
import { autonomyStatus } from "../tasks/autonomy";
import { readStateSummary } from "../tasks/state-summary";
import { type ApiContext, json } from "./context";
import { eventStream } from "./events";

export async function handleRead(
  request: Request,
  url: URL,
  { store, engine, requireTask }: ApiContext,
) {
  const path = url.pathname;
  if (path === "/connections/github") return json(await githubAccounts());
  if (path === "/folders") {
    try {
      if (url.searchParams.getAll("path").length > 1)
        throw new FolderError("Provide only one folder path.", 400);
      return json(await listFolders(url.searchParams.get("path") ?? undefined));
    } catch (error) {
      if (error instanceof FolderError)
        return json({ error: error.message }, error.status);
      throw error;
    }
  }
  const gateway = /^\/connections\/(codex|claude)\/gateway$/.exec(path);
  if (gateway) return json(gatewayView(providerSchema.parse(gateway[1])));
  if (path === "/machine") return json(readMachineIdentity(dataDir));
  const stateSummary = path.match(/^\/tasks\/([^/]+)\/state-summary$/);
  if (stateSummary) return json(readStateSummary(store, stateSummary[1]));
  const autonomy = path.match(/^\/tasks\/([^/]+)\/autonomy$/);
  if (autonomy) return json(autonomyStatus(store, autonomy[1]));
  if (path === "/models") return json(await modelCatalog(store));
  const git = path.match(/^\/tasks\/([^/]+)\/git$/);
  if (git) return json(await gitStatus(store, git[1]));
  const templates = path.match(/^\/tasks\/([^/]+)\/git\/templates$/);
  if (templates)
    return json(await gitPullRequestTemplates(store, templates[1]));
  const gitRemote = path.match(/^\/tasks\/([^/]+)\/git\/remote$/);
  if (gitRemote) return json(await gitRemoteStatus(store, gitRemote[1]));
  const projectPRContext = path.match(
    /^\/projects\/([^/]+)\/pull-requests\/context$/,
  );
  if (projectPRContext) {
    const project = store.get("project", projectPRContext[1]);
    if (!project) throw new Error("Project not found.");
    const login = url.searchParams.get("login");
    const account = login
      ? githubAccountBindingSchema.parse({ hostname: "github.com", login })
      : project.githubAccount;
    return json(
      await withGithubAccount(account, () =>
        readPullRequestContext(url.searchParams.get("url") ?? "", project),
      ),
    );
  }
  const projectPRs = path.match(/^\/projects\/([^/]+)\/pull-requests$/);
  if (projectPRs) {
    const project = store.get("project", projectPRs[1]);
    if (!project) throw new Error("Project not found.");
    const state = pullRequestListStateSchema.parse(
      url.searchParams.get("state") ?? "open",
    );
    return json(await listProjectPullRequests(project, state));
  }
  const files = path.match(/^\/tasks\/([^/]+)\/files$/);
  if (files) return json(await engine.files(requireTask(files[1])));
  const file = path.match(/^\/tasks\/([^/]+)\/file$/);
  if (file)
    return json(
      await engine.file(
        requireTask(file[1]),
        url.searchParams.get("path") ?? "",
      ),
    );
  if (path === "/snapshot")
    return json({
      projects: store.all("project"),
      tasks: store
        .all("task")
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      presets: store.all("preset"),
      notes: store.all("note"),
      settings: store.get("settings", "default"),
      runtime: await engine.runtime(),
      sequence: store.sequence(),
    });
  if (path === "/events") return eventStream(request, url, store);
  const match = path.match(/^\/tasks\/([^/]+)(\/patch)?$/);
  if (match) {
    const task = requireTask(match[1]);
    const turns = store.all("turn").filter((t) => t.taskId === task.id);
    if (match[2]) {
      const result = turns.at(-1)?.result;
      if (!result) throw new Error("No patch is available.");
      if (result.truncated)
        throw new Error("The patch exceeds the export limit.");
      return new Response(result.diff, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Content-Disposition": `attachment; filename="nerilo-${task.id.slice(0, 8)}.patch"`,
        },
      });
    }
    return json({ task, turns, events: store.events(task.id) });
  }
  return json({ error: "Not found" }, 404);
}
