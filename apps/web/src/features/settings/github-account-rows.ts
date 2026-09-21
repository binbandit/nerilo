import type { GithubAccounts } from "@nerilo/protocol";

type Host = GithubAccounts["hosts"][number];
type Account = Host["accounts"][number];
type AccountRow = Account & {
  environment: boolean;
  savedState: Account["state"] | null;
};

export function githubAccountRows(host: Host) {
  const rows = new Map<string, AccountRow>();
  for (const [index, account] of host.accounts.entries()) {
    const key = account.login.toLowerCase() || `unknown:${index}`;
    const environment = Boolean(host.environmentToken && account.active);
    const previous = rows.get(key);
    rows.set(key, {
      ...(previous && !account.active ? previous : account),
      environment: environment || Boolean(previous?.environment),
      savedState: environment ? (previous?.savedState ?? null) : account.state,
    });
  }
  return [...rows.values()];
}
