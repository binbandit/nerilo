import type { GithubAccounts, GithubAccountSelection } from "@nerilo/protocol";

export function resolvedGithubLogin(
  value: GithubAccountSelection | null | undefined,
  inherited: GithubAccountSelection | null | undefined,
  accounts: GithubAccounts | undefined,
) {
  return (
    value?.login ??
    inherited?.login ??
    accounts?.hosts
      .find((host) => host.hostname === "github.com")
      ?.accounts.find(
        (account) => account.active && account.state === "success",
      )?.login ??
    null
  );
}
