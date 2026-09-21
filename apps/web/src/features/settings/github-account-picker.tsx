"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, RefreshCw } from "lucide-react";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import type { GithubAccountSelection } from "@nerilo/protocol";
import { GithubIcon } from "@/components/ui/github-icon";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { resolvedGithubLogin } from "@/features/settings/github-account-label";

export function GithubAccountPicker({
  value,
  inherited,
  scope,
  onChange,
  disabled = false,
  compact = false,
}: {
  value: GithubAccountSelection | null | undefined;
  inherited?: GithubAccountSelection | null;
  scope: "project" | "task";
  onChange: (account: GithubAccountSelection | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const { machineId, ready } = useSession();
  const query = useQuery({
    ...queries.githubAccounts(machineId),
    enabled: ready,
  });
  const host = query.data?.hosts.find((host) => host.hostname === "github.com");
  const accounts =
    host?.accounts.filter(
      (account) => account.login && !(host.environmentToken && account.active),
    ) ?? [];
  const defaultLogin = resolvedGithubLogin(null, inherited, query.data);
  const resolvedLogin = resolvedGithubLogin(value, inherited, query.data);
  const defaultLabel = `${scope === "project" ? "Use machine default" : "Use project default"} (${defaultLogin ? `@${defaultLogin}` : query.isPending ? "loading account…" : "account unavailable"})`;
  const selected = value ? `@${value.login}` : defaultLabel;
  return (
    <div className="github-account-picker">
      <DropdownMenu
        alignment="start"
        menuWidth={300}
        button={{
          label: compact
            ? resolvedLogin
              ? `@${resolvedLogin}`
              : "GitHub account unavailable"
            : selected,
          "aria-label": `GitHub account: ${selected}`,
          icon: <GithubIcon size={15} />,
          variant: "ghost",
          size: "sm",
          isDisabled: disabled,
        }}
        items={[
          {
            label: defaultLabel,
            icon: !value ? <Check size={14} /> : undefined,
            onClick: () => onChange(null),
          },
          { type: "divider" },
          ...accounts.map((account) => ({
            label: `@${account.login}${account.state === "success" ? "" : " (login unavailable)"}`,
            icon:
              value?.login === account.login ? <Check size={14} /> : undefined,
            isDisabled: query.isError || account.state !== "success",
            onClick: () =>
              onChange({ hostname: "github.com", login: account.login }),
          })),
          ...(accounts.length
            ? []
            : [
                {
                  label: query.isPending
                    ? "Loading GitHub accounts…"
                    : "No saved GitHub accounts",
                  isDisabled: true,
                },
              ]),
          { type: "divider" },
          {
            label: "Refresh accounts",
            icon: <RefreshCw size={14} />,
            isDisabled: query.isFetching,
            onClick: () => {
              void query.refetch();
            },
          },
        ]}
      />
      {query.error && (
        <p className="error-note" role="alert">
          {query.error.message}
        </p>
      )}
    </div>
  );
}

export function ResolvedGithubAccount({
  value,
  inherited,
}: {
  value: GithubAccountSelection | null | undefined;
  inherited?: GithubAccountSelection | null;
}) {
  const { machineId, ready } = useSession();
  const query = useQuery({
    ...queries.githubAccounts(machineId),
    enabled: ready,
  });
  const login = resolvedGithubLogin(value, inherited, query.data);
  return (
    <span className="resolved-github-account">
      {login
        ? `GitHub: @${login}`
        : query.isPending
          ? "Loading GitHub account…"
          : "GitHub account unavailable"}
    </span>
  );
}
