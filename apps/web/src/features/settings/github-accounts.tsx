"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown, RefreshCw } from "lucide-react";
import { GithubIcon } from "@/components/ui/github-icon";
import { Button } from "@/components/ui/ui";
import { CopyTextButton } from "@/components/ui/copy-text-button";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { useApiMutation } from "@/lib/use-api-mutation";
import { githubAccountRows } from "@/features/settings/github-account-rows";
import "@/features/settings/github-accounts.css";

export function GithubAccounts() {
  const { machineId, ready } = useSession();
  const accounts = useQuery({
    ...queries.githubAccounts(machineId),
    enabled: ready,
  });
  const switching = useApiMutation("github-account");
  const disabled =
    switching.isPending || accounts.isFetching || accounts.isError;

  return (
    <section
      className="github-accounts"
      aria-labelledby="github-accounts-heading"
    >
      <header className="github-accounts-heading">
        <div className="preferences-row-copy">
          <h3 id="github-accounts-heading">
            <GithubIcon size={17} /> GitHub
          </h3>
          <p>
            Choose the machine default. Projects and tasks can use their own
            GitHub.com account.
          </p>
        </div>
        <Button
          label="Refresh accounts"
          icon={<RefreshCw size={14} />}
          size="sm"
          variant="ghost"
          isLoading={accounts.isFetching}
          isDisabled={!ready || switching.isPending || accounts.isFetching}
          onClick={() => {
            switching.reset();
            void accounts.refetch();
          }}
        />
      </header>
      {accounts.isPending && (
        <p className="preferences-footnote" role="status">
          Loading GitHub accounts…
        </p>
      )}
      {accounts.error && (
        <p className="error-note" role="alert">
          {accounts.error.message}
        </p>
      )}
      {accounts.data?.hosts.map((host) => (
        <div key={host.hostname} className="github-account-host">
          {host.environmentToken && (
            <p className="preferences-footnote" role="status">
              The machine default for {host.hostname} is set by{" "}
              {host.environmentToken}.{" "}
              {host.hostname === "github.com"
                ? "You can still choose saved accounts for individual projects and tasks. "
                : ""}
              To change the machine default here, remove that variable from
              Nerilo’s startup environment and restart Nerilo.
            </p>
          )}
          <div className="preferences-rows">
            {githubAccountRows(host).map((account, index) => (
              <div
                className="preferences-row"
                key={`${account.login}:${index}`}
              >
                <div className="preferences-row-copy">
                  <h3>
                    {account.login ? `@${account.login}` : "Environment token"}
                  </h3>
                  <p>
                    {host.hostname}
                    {account.environment
                      ? account.savedState
                        ? " · Environment default and saved login"
                        : " · Environment default"
                      : " · Saved login"}
                    {account.environment &&
                    account.savedState &&
                    account.savedState !== "success"
                      ? " · Saved login needs attention for project and task overrides"
                      : ""}
                    {account.state === "error"
                      ? account.environment
                        ? " · Environment authentication needs attention"
                        : " · Sign in again to use this account"
                      : account.state === "timeout"
                        ? " · Could not reach GitHub. Refresh to retry."
                        : ""}
                  </p>
                </div>
                {account.active ? (
                  <span
                    className={`preferences-status ${account.state === "success" ? "" : "is-unavailable"}`}
                  >
                    <span />
                    {account.state === "success"
                      ? "Machine default"
                      : "Default needs attention"}
                  </span>
                ) : host.environmentToken ? (
                  <span
                    className={`preferences-status ${account.state === "success" ? "" : "is-unavailable"}`}
                  >
                    {account.state === "success"
                      ? host.hostname === "github.com"
                        ? "Available for projects and tasks"
                        : "Saved account"
                      : "Saved login unavailable"}
                  </span>
                ) : (
                  <Button
                    label="Use as default"
                    aria-label={`Use ${account.login} as machine default on ${host.hostname}`}
                    size="sm"
                    isDisabled={disabled || account.state !== "success"}
                    onClick={() =>
                      switching.mutate({
                        path: "connections/github/switch",
                        body: { hostname: host.hostname, login: account.login },
                      })
                    }
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
      {accounts.data &&
        !accounts.data.hosts.some((host) => host.accounts.length) && (
          <p className="preferences-footnote">
            No GitHub accounts are signed in on this machine.
          </p>
        )}
      {switching.isPending && (
        <p className="preferences-footnote" role="status">
          Changing the machine default…
        </p>
      )}
      {switching.error && (
        <p className="error-note" role="alert">
          {switching.error.message}
        </p>
      )}
      {switching.isSuccess && (
        <p className="success-note" role="status">
          Machine default GitHub account changed.
        </p>
      )}
      <p className="preferences-footnote">
        Switching changes the machine default for GitHub CLI and Nerilo.
        Projects and tasks with their own account keep using it. Your Git commit
        author and SSH keys stay the same.
      </p>
      <details className="preferences-note">
        <summary>
          <ChevronDown size={13} />
          Add another GitHub account
        </summary>
        <p>
          Run this in a terminal on the selected machine, complete sign-in, then
          refresh accounts:
        </p>
        <div className="github-login-command">
          <code>gh auth login</code>
          <CopyTextButton
            text="gh auth login"
            label="Copy GitHub sign-in command"
          />
        </div>
      </details>
    </section>
  );
}
