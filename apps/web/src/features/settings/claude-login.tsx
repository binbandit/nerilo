"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Modal } from "@/components/editors/editors";
import { Button, Text, TextInput } from "@/components/ui/ui";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys, queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { read } from "@/lib/api";
import type { Provider } from "@nerilo/protocol";

type LoginState = {
  state: "idle" | "starting" | "waiting" | "connected" | "failed";
  url: string | null;
  error: string | null;
  deviceCode?: string | null;
};
function parseLogin(value: unknown): LoginState {
  if (
    !value ||
    typeof value !== "object" ||
    !("state" in value) ||
    typeof value.state !== "string" ||
    !["idle", "starting", "waiting", "connected", "failed"].includes(
      value.state,
    )
  )
    throw new Error("Sign-in status unavailable.");
  return {
    state: value.state as LoginState["state"],
    deviceCode:
      "deviceCode" in value && typeof value.deviceCode === "string"
        ? value.deviceCode
        : null,
    url: "url" in value && typeof value.url === "string" ? value.url : null,
    error:
      "error" in value && typeof value.error === "string" ? value.error : null,
  };
}
export function AgentLogin({
  provider,
  onClose,
  onConnected,
}: {
  provider: Provider;
  onClose: () => void;
  onConnected: () => void;
}) {
  const { mutateAsync: send } = useApiMutation(`connection:${provider}`);
  const client = useQueryClient();
  const { machineId } = useSession();
  const endpoint = `connections/${provider}/login`;
  const codex = provider === "codex";
  const [login, setLogin] = useState<LoginState>({
    state: "starting",
    url: null,
    error: null,
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const connected = useEffectEvent(() => {
    void client.invalidateQueries({ queryKey: queryKeys.snapshot(machineId) });
    void client.invalidateQueries({
      queryKey: queries.models(machineId).queryKey,
    });
    onConnected();
  });
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    let checking = false;
    let finished = false;
    const receive = (data: unknown) => {
      if (disposed || finished) return;
      const next = parseLogin(data);
      setLogin(next);
      if (next.state === "connected") {
        finished = true;
        connected();
      }
    };
    void send({ path: endpoint, body: { action: "start" } })
      .then(receive)
      .catch((reason: unknown) => {
        if (!disposed)
          setError(
            reason instanceof Error
              ? reason.message
              : "Sign-in could not start.",
          );
      });
    const timer = setInterval(() => {
      if (checking || finished) return;
      checking = true;
      void read(endpoint, controller.signal, machineId)
        .then(receive)
        .catch((reason: unknown) => {
          if (!disposed)
            setError(
              reason instanceof Error
                ? reason.message
                : "Sign-in status unavailable.",
            );
        })
        .finally(() => {
          checking = false;
        });
    }, 1500);
    return () => {
      disposed = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [endpoint, machineId, send]);
  const close = () => {
    void send({ path: endpoint, body: { action: "cancel" } }).catch(() => {});
    onClose();
  };
  return (
    <Modal
      title={codex ? "Sign in to ChatGPT" : "Sign in to Claude Code"}
      width={460}
      onClose={close}
      footer={
        <>
          <Button label="Cancel" variant="ghost" onClick={close} />
          {login.state === "failed" ? (
            <Button
              label="Try again"
              onClick={() => {
                setError("");
                void send({ path: endpoint, body: { action: "start" } })
                  .then((value) => setLogin(parseLogin(value)))
                  .catch((reason: unknown) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Sign-in failed.",
                    ),
                  );
              }}
            />
          ) : !codex ? (
            <Button
              label="Continue"
              variant="primary"
              isDisabled={!code.trim() || busy || login.state !== "waiting"}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await send({
                    path: endpoint,
                    body: {
                      action: "code",
                      code,
                    },
                  });
                  setCode("");
                } catch (reason) {
                  setError(
                    reason instanceof Error
                      ? reason.message
                      : "The code could not be submitted.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : null}
        </>
      }
    >
      <div className="form-stack">
        <Text>
          {codex
            ? "Use your ChatGPT subscription with Codex. Open sign-in and enter the one-time code below. This window will close when you’re connected."
            : "Use your Claude subscription. Open sign-in, then paste the authorization code from your browser."}
        </Text>
        {login.url ? (
          <a href={login.url} target="_blank" rel="noreferrer">
            Open {codex ? "ChatGPT" : "Claude"} sign-in ↗
          </a>
        ) : (
          <Text type="supporting">
            {login.state === "failed"
              ? "Sign-in did not finish."
              : `Preparing ${codex ? "Codex" : "Claude Code"}…`}
          </Text>
        )}
        {codex ? (
          login.deviceCode && (
            <TextInput
              label="One-time sign-in code"
              value={login.deviceCode}
              isReadOnly
            />
          )
        ) : (
          <TextInput
            label="Authorization code"
            value={code}
            onChange={setCode}
            placeholder="Paste the code from Claude"
          />
        )}
        {(error || login.error) && (
          <div className="error-note" role="alert">
            {error || login.error}
          </div>
        )}
      </div>
    </Modal>
  );
}
