"use client";
import {
  providerNames,
  providerSchema,
  isMultiProviderHarness,
} from "@nerilo/protocol";

import { useState } from "react";
import { MoreHorizontal, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  type DropdownMenuOption,
} from "@astryxdesign/core/DropdownMenu";
import type { Provider, Snapshot } from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Button } from "@/components/ui/ui";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { GatewayDialog } from "@/features/settings/gateway-dialog";
import { GithubAccounts } from "@/features/settings/github-accounts";

export function ConnectionSettings({
  data,
  busy,
  act,
  addKey,
  signIn,
  disconnect,
}: {
  data: Snapshot;
  busy: boolean;
  act: (path: string, body?: unknown) => Promise<boolean>;
  addKey: (provider: Provider) => void;
  signIn: (provider: Provider) => void;
  disconnect: (provider: Provider) => void;
}) {
  const { mutateAsync: send } = useApiMutation("settings");
  const [gateway, setGateway] = useState<Provider | null>(null);
  const [checking, setChecking] = useState<Provider | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const check = async (provider: Provider) => {
    if (checking) return;
    setChecking(provider);
    setResult(null);
    try {
      await send({ path: `connections/${provider}/test` });
      setResult({
        ok: true,
        text: `${providerNames[provider]} responded successfully through the saved connection.`,
      });
    } catch (reason) {
      setResult({
        ok: false,
        text:
          reason instanceof Error
            ? reason.message
            : "The connection check failed. Check the saved settings and try again.",
      });
    } finally {
      setChecking(null);
    }
  };
  return (
    <>
      <header className="preferences-heading">
        <h2>Connections</h2>
        <p>Manage your AI and GitHub connections on this machine.</p>
      </header>
      <div className="preferences-rows">
        {providerSchema.options.map((provider) => {
          const connection = data.runtime.connections[provider];
          const name = providerNames[provider];
          const disabled = busy || Boolean(checking);
          const options: DropdownMenuOption[] = [
            ...(connection.canImport
              ? [
                  {
                    label: isMultiProviderHarness(provider)
                      ? "Import existing API keys"
                      : connection.source.startsWith("Imported")
                        ? "Refresh existing login"
                        : "Use existing login",
                    isDisabled:
                      disabled ||
                      (provider === "claude" &&
                        (!data.runtime.docker || !data.runtime.image)),
                    onClick: () => {
                      setResult(null);
                      void act("connections", { provider, action: "import" });
                    },
                  },
                ]
              : []),
            ...(!isMultiProviderHarness(provider)
              ? [
                  {
                    label:
                      provider === "codex"
                        ? "Sign in to ChatGPT"
                        : "Sign in to Claude Code",
                    onClick: () => signIn(provider),
                    isDisabled:
                      disabled || !data.runtime.image || !data.runtime.docker,
                  },
                  {
                    label:
                      connection.mode === "gateway"
                        ? "Edit company gateway…"
                        : "Use a company gateway…",
                    onClick: () => {
                      setResult(null);
                      setGateway(provider);
                    },
                    isDisabled: disabled,
                  },
                ]
              : []),
            {
              label: "Use an API key…",
              onClick: () => {
                setResult(null);
                addKey(provider);
              },
              isDisabled: disabled,
            },
            ...(connection.ready
              ? [
                  { type: "divider" as const },
                  {
                    label: "Disconnect",
                    onClick: () => {
                      setResult(null);
                      disconnect(provider);
                    },
                    isDisabled: disabled,
                  },
                ]
              : []),
          ];
          return (
            <div className="preferences-provider" key={provider}>
              <span className="preferences-provider-icon" aria-hidden="true">
                <ProviderIcon provider={provider} size={24} />
              </span>
              <div className="preferences-row-copy">
                <h3>{name}</h3>
                <p>
                  {connection.ready
                    ? connection.source
                    : connection.canImportGateway
                      ? "Company gateway settings available"
                      : connection.canImport
                        ? isMultiProviderHarness(provider)
                          ? "Existing API keys available"
                          : "Existing login available"
                        : "Choose a connection to get started"}
                </p>
              </div>
              <div className="preferences-row-actions">
                {!connection.ready && connection.canImport && (
                  <Button
                    label={
                      isMultiProviderHarness(provider)
                        ? "Import existing API keys"
                        : "Use existing login"
                    }
                    size="sm"
                    isDisabled={
                      disabled ||
                      (provider === "claude" &&
                        (!data.runtime.docker || !data.runtime.image))
                    }
                    onClick={() => {
                      setResult(null);
                      void act("connections", { provider, action: "import" });
                    }}
                  />
                )}
                {connection.ready && (
                  <Button
                    label="Test connection"
                    size="sm"
                    isLoading={checking === provider}
                    isDisabled={
                      disabled || !data.runtime.docker || !data.runtime.image
                    }
                    onClick={() => void check(provider)}
                  />
                )}
                <DropdownMenu
                  button={{
                    label:
                      connection.ready || connection.canImport
                        ? `${name} connection options`
                        : "Connect",
                    "aria-label": `${name} connection options`,
                    isIconOnly: connection.ready || connection.canImport,
                    ...(connection.ready || connection.canImport
                      ? { icon: <MoreHorizontal size={17} /> }
                      : {}),
                    variant:
                      connection.ready || connection.canImport
                        ? "ghost"
                        : "secondary",
                    size: "sm",
                    isDisabled: disabled,
                  }}
                  hasChevron={!connection.ready && !connection.canImport}
                  alignment="end"
                  items={options}
                />
              </div>
            </div>
          );
        })}
      </div>
      {result && (
        <div
          role={result.ok ? "status" : "alert"}
          className={result.ok ? "success-note" : "error-note"}
        >
          {result.text}
        </div>
      )}
      <p className="preferences-footnote">
        Connect an agent to start. Test the connection to confirm your account
        and model can respond.
      </p>
      <details className="preferences-note">
        <summary>
          <ChevronDown size={13} />
          How credentials are stored
        </summary>
        <p>
          Direct API keys use macOS Keychain. Nerilo keeps imported logins and
          gateway settings in private local storage. A key manager command stays
          on the machine running Nerilo and resolves a fresh key for each
          request. Disconnecting removes Nerilo’s connection.
        </p>
      </details>
      <GithubAccounts />
      {gateway && (
        <GatewayDialog
          key={gateway}
          provider={gateway}
          canImport={data.runtime.connections[gateway].canImportGateway}
          onClose={() => setGateway(null)}
        />
      )}
    </>
  );
}
