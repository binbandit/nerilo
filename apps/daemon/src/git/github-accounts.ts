import { z } from "zod";
import {
  githubAccountSelectionSchema,
  type GithubAccounts,
} from "@nerilo/protocol";
import { command } from "../platform/config";

const statusSchema = z.object({
  hosts: z.record(
    z.string(),
    z.array(
      z.object({
        login: z.string(),
        active: z.boolean(),
        state: z.enum(["success", "error", "timeout"]),
        tokenSource: z.string(),
      }),
    ),
  ),
});
const environmentTokens = [
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
] as const;

async function runGithub(args: string[], run: typeof command) {
  let result: Awaited<ReturnType<typeof command>>;
  try {
    result = await run(["gh", "auth", ...args], {
      timeout: 15000,
      env: { GH_PROMPT_DISABLED: "1", GH_SPINNER_DISABLED: "1" },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    )
      throw new Error(
        "Install GitHub CLI on this machine, then refresh accounts.",
      );
    throw new Error(
      "Could not run GitHub CLI on this machine. Check its installation and try again.",
    );
  }
  if (result.code === 124)
    throw new Error(
      "GitHub took too long to respond. Check this machine’s connection and refresh accounts.",
    );
  if (result.code !== 0)
    throw new Error(
      args[0] === "switch"
        ? "Could not switch GitHub accounts. Refresh accounts and sign in again with gh auth login if needed."
        : "Could not read GitHub accounts. Check that GitHub CLI is up to date on this machine, then refresh.",
    );
  return result.stdout;
}

export async function githubAccounts(run = command): Promise<GithubAccounts> {
  const output = await runGithub(["status", "--json", "hosts"], run);
  let status: z.infer<typeof statusSchema>;
  try {
    status = statusSchema.parse(JSON.parse(output));
  } catch {
    throw new Error(
      "GitHub CLI returned an unexpected account status. Update GitHub CLI on this machine and refresh.",
    );
  }
  // Return only account metadata. CLI output can include tokens and diagnostics.
  return {
    hosts: Object.entries(status.hosts).map(([hostname, accounts]) => ({
      hostname,
      environmentToken:
        environmentTokens.find((token) =>
          accounts.some(
            (account) => account.active && account.tokenSource === token,
          ),
        ) ?? null,
      accounts: accounts.map(({ login, active, state }) => ({
        login,
        active,
        state,
      })),
    })),
  };
}

export async function switchGithubAccount(input: unknown, run = command) {
  const { hostname, login } = githubAccountSelectionSchema.parse(input);
  const current = await githubAccounts(run);
  const host = current.hosts.find((host) => host.hostname === hostname);
  if (host?.environmentToken)
    throw new Error(
      `GitHub authentication is set by ${host.environmentToken}. Remove it from the daemon’s environment and restart Nerilo on this machine to switch accounts.`,
    );
  const account = host?.accounts.find((account) => account.login === login);
  if (!account)
    throw new Error(
      "This GitHub account is no longer saved on this machine. Refresh accounts and try again.",
    );
  if (account.state !== "success")
    throw new Error(
      "This GitHub login could not be verified. Check the connection or sign in again with gh auth login, then refresh accounts.",
    );
  if (account.active) return current;
  await runGithub(["switch", "--hostname", hostname, "--user", login], run);
  let updated: GithubAccounts;
  try {
    updated = await githubAccounts(run);
  } catch {
    throw new Error(
      "GitHub CLI accepted the switch, but its active account could not be verified. Refresh accounts to confirm.",
    );
  }
  const updatedHost = updated.hosts.find((host) => host.hostname === hostname);
  if (
    updatedHost?.environmentToken ||
    !updatedHost?.accounts.some(
      (account) =>
        account.login === login &&
        account.active &&
        account.state === "success",
    )
  )
    throw new Error(
      "GitHub CLI did not confirm the selected account as active. Refresh accounts and try again.",
    );
  return updated;
}
