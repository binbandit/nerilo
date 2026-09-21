import { AsyncLocalStorage } from "node:async_hooks";
import {
  githubAccountBindingSchema,
  type GithubAccountSelection,
} from "@nerilo/protocol";
import type { Store } from "../platform/store";

type Run = (
  args: string[],
  options: { timeout: number; env: Record<string, string> },
) => Promise<{ code: number; stdout: string; stderr: string }>;
const context = new AsyncLocalStorage<{
  account: GithubAccountSelection | null;
  token?: Promise<string>;
}>();

export class GithubAccountUnavailableError extends Error {
  constructor(login: string) {
    super(
      `The saved GitHub login for @${login} is unavailable. Sign in on this machine with gh auth login, or choose another account.`,
    );
    this.name = "GithubAccountUnavailableError";
  }
}

export function taskGithubAccount(store: Store, taskId: string) {
  const task = store.get("task", taskId);
  if (!task) throw new Error("Task not found.");
  return (
    task.githubAccount ??
    store.get("project", task.projectId)?.githubAccount ??
    null
  );
}

export function withGithubAccount<T>(
  account: GithubAccountSelection | null | undefined,
  action: () => T,
): T {
  return context.run(
    { account: account ? githubAccountBindingSchema.parse(account) : null },
    action,
  );
}

export function withTaskGithubAccount<T>(
  store: Store,
  taskId: string,
  action: () => T,
): T {
  return withGithubAccount(taskGithubAccount(store, taskId), action);
}

// The selected identity lives in this async operation, never in process.env or
// gh's global active-account setting. Parallel tasks get independent tokens.
export async function githubCommandEnvironment(args: string[], run: Run) {
  const scope = context.getStore();
  const networkGit =
    args[0] === "git" &&
    args.includes("credential.helper=!gh auth git-credential");
  if (
    !scope?.account ||
    !(networkGit || (args[0] === "gh" && args[1] !== "auth"))
  )
    return null;
  const account = scope.account;
  scope.token ??= (async () => {
    try {
      const result = await run(
        [
          "gh",
          "auth",
          "token",
          "--hostname",
          account.hostname,
          "--user",
          account.login,
        ],
        {
          timeout: 15000,
          env: {
            GH_TOKEN: "",
            GITHUB_TOKEN: "",
            GH_ENTERPRISE_TOKEN: "",
            GITHUB_ENTERPRISE_TOKEN: "",
            GH_PROMPT_DISABLED: "1",
            GH_DEBUG: "",
          },
        },
      );
      const token = result.stdout.trim();
      if (result.code === 0 && token && !/\s/.test(token)) return token;
    } catch {
      /* Never return CLI output that could contain credentials. */
    }
    throw new GithubAccountUnavailableError(account.login);
  })();
  return {
    GH_TOKEN: await scope.token,
    GITHUB_TOKEN: "",
    GH_HOST: account.hostname,
    GH_PROMPT_DISABLED: "1",
    GH_DEBUG: "",
  };
}
