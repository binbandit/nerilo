"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/editors";
import { Button, Text, TextInput } from "@/components/ui";
import { read, mutate } from "@/lib/api";

type LoginState = {
  state: "idle" | "starting" | "waiting" | "connected" | "failed";
  url: string | null;
  error: string | null;
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
    url: "url" in value && typeof value.url === "string" ? value.url : null,
    error:
      "error" in value && typeof value.error === "string" ? value.error : null,
  };
}
export function ClaudeLogin({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: () => void;
}) {
  const [login, setLogin] = useState<LoginState>({
    state: "starting",
    url: null,
    error: null,
  });
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const connected = useRef(onConnected);
  connected.current = onConnected;
  useEffect(() => {
    let disposed = false;
    let checking = false;
    let finished = false;
    const receive = (data: unknown) => {
      if (disposed || finished) return;
      const next = parseLogin(data);
      setLogin(next);
      if (next.state === "connected") {
        finished = true;
        connected.current();
      }
    };
    void mutate("connections/claude/login", { action: "start" })
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
      void read("connections/claude/login")
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
      clearInterval(timer);
    };
  }, []);
  const close = () => {
    void mutate("connections/claude/login", { action: "cancel" }).catch(
      () => {},
    );
    onClose();
  };
  return (
    <Modal
      title="Sign in to Claude Code"
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
                void mutate("connections/claude/login", { action: "start" })
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
          ) : (
            <Button
              label="Continue"
              variant="primary"
              isDisabled={!code.trim() || busy || login.state !== "waiting"}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await mutate("connections/claude/login", {
                    action: "code",
                    code,
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
          )}
        </>
      }
    >
      <div className="form-stack">
        <Text>
          Your Claude subscription works here. Sign in through Claude Code, then
          paste the authorization code from your browser.
        </Text>
        {login.url ? (
          <a href={login.url} target="_blank" rel="noreferrer">
            Open Claude sign-in ↗
          </a>
        ) : (
          <Text type="supporting">
            {login.state === "failed"
              ? "Sign-in did not finish."
              : "Preparing Claude Code…"}
          </Text>
        )}
        <TextInput
          label="Authorization code"
          value={code}
          onChange={setCode}
          placeholder="Paste the code from Claude"
        />
        {(error || login.error) && (
          <div className="error-note" role="alert">
            {error || login.error}
          </div>
        )}
      </div>
    </Modal>
  );
}
