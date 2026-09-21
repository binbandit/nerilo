"use client";
import { providerNames } from "@nerilo/protocol";

import { useRef, useState } from "react";
import {
  gatewayInputSchema,
  gatewayViewSchema,
  type GatewayView,
  type Provider,
} from "@nerilo/protocol";
import { useApiMutation } from "@/lib/use-api-mutation";
import { Modal } from "@/components/editors/editors";
import {
  Button,
  Selector,
  Text,
  TextArea,
  TextInput,
} from "@/components/ui/ui";
import { useQuery } from "@tanstack/react-query";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";

function pairs(value: string, separator: string) {
  const result: Record<string, string> = {};
  for (const line of value.split(/\r?\n/).filter((line) => line.trim())) {
    const position = line.indexOf(separator);
    if (position < 1)
      throw new Error(`Use one name${separator}value per line.`);
    const name = line.slice(0, position).trim();
    if (
      Object.keys(result).some(
        (key) => key.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error(`Remove the duplicate ${name} entry.`);
    result[name] = line.slice(position + 1).trim();
  }
  return result;
}
type GatewayProps = {
  provider: Provider;
  canImport: boolean;
  onClose: () => void;
};

export function GatewayDialog(props: GatewayProps) {
  const { machineId, ready } = useSession();
  const profile = useQuery({
    ...queries.gateway(machineId, props.provider),
    enabled: ready,
  });
  if (profile.data === undefined)
    return (
      <Modal title="Company gateway" onClose={props.onClose} width={560}>
        {profile.error ? (
          <div role="alert">
            <Text>{profile.error.message}</Text>
            <Button label="Try again" onClick={() => void profile.refetch()} />
          </div>
        ) : (
          <Text>Loading connection…</Text>
        )}
      </Modal>
    );
  return <GatewayForm key={props.provider} {...props} initial={profile.data} />;
}

function GatewayForm({
  provider,
  canImport,
  onClose,
  initial,
}: GatewayProps & { initial: GatewayView | null }) {
  const { mutateAsync: send } = useApiMutation(`connection:${provider}`);
  const [saved, setSaved] = useState(initial);
  const [url, setUrl] = useState(initial?.baseUrl ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [credential, setCredential] = useState<
    GatewayView["credential"]["type"]
  >(initial?.credential.type ?? "key");
  const [value, setValue] = useState("");
  const [variable, setVariable] = useState(
    initial?.credential.variable ?? "AI_GATEWAY_API_KEY",
  );
  const [authHeader, setAuthHeader] = useState<string>(
    initial?.authHeader ?? "authorization",
  );
  const [headers, setHeaders] = useState("");
  const [replaceHeaders, setReplaceHeaders] = useState(false);
  const [env, setEnv] = useState(() =>
    Object.entries(initial?.env ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
  );
  const [certificate, setCertificate] = useState("");
  const [replaceCertificate, setReplaceCertificate] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const populate = (profile: GatewayView | null) => {
    setSaved(profile);
    if (!profile) return;
    setUrl(profile.baseUrl);
    setModel(profile.model);
    setCredential(profile.credential.type);
    setVariable(profile.credential.variable ?? "AI_GATEWAY_API_KEY");
    setAuthHeader(profile.authHeader);
    setEnv(
      Object.entries(profile.env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n"),
    );
    setValue("");
    setHeaders("");
    setReplaceHeaders(false);
    setCertificate("");
    setReplaceCertificate(false);
  };
  const action = async (importSettings: boolean) => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let input: unknown = {};
      if (!importSettings) {
        const parsed = gatewayInputSchema.safeParse({
          baseUrl: url,
          model,
          authHeader,
          credential:
            credential === "environment"
              ? { type: credential, variable }
              : { type: credential, value: value || undefined },
          ...(headers.trim() || replaceHeaders
            ? { headers: pairs(headers, ":"), headerEnv: {} }
            : {}),
          env: pairs(env, "="),
          ...(certificate.trim() || replaceCertificate
            ? { caCertificate: certificate }
            : {}),
        });
        if (!parsed.success)
          throw new Error(
            parsed.error.issues.map((issue) => issue.message).join(" "),
          );
        input = parsed.data;
      }
      populate(
        gatewayViewSchema.parse(
          await send({
            path: `connections/${provider}/${importSettings ? "gateway-import" : "gateway"}`,
            body: input,
          }),
        ),
      );

      if (importSettings)
        setNotice(
          "Imported the connection settings. Model routing is ready to review below.",
        );
      else onClose();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The connection could not be saved.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`${providerNames[provider]} · Company gateway`}
      width={560}
      onClose={() => {
        if (!busy) onClose();
      }}
      onSubmit={() => void action(false)}
      footer={
        <>
          <Button label="Cancel" isDisabled={busy} onClick={onClose} />
          <Button
            label="Save connection"
            variant="primary"
            isLoading={busy}
            isDisabled={busy || !url.trim() || !model.trim()}
            onClick={() => void action(false)}
          />
        </>
      }
    >
      <Text color="secondary">
        Use the connection details from your company. Your agent sends requests
        to this gateway.
      </Text>
      {canImport && (
        <Button
          label="Use this agent’s gateway settings"
          isDisabled={busy}
          onClick={() => void action(true)}
        />
      )}
      <>
        <TextInput
          label="Gateway URL"
          value={url}
          onChange={setUrl}
          placeholder="https://gateway.company.com"
          hasAutoFocus
        />
        <TextInput
          label="Gateway model"
          value={model}
          onChange={setModel}
          placeholder={
            provider === "claude"
              ? "opus or your company’s model ID"
              : "Your company’s model ID"
          }
        />
        <Text type="supporting">
          Used when model selection follows this gateway. Choose a model in the
          agent settings to override it for a task.
        </Text>
        <Selector
          label="API key source"
          value={credential}
          onChange={(type) => {
            setCredential(
              gatewayViewSchema.shape.credential.shape.type.parse(type),
            );
            setValue("");
          }}
          options={[
            { value: "key", label: "Enter an API key" },
            { value: "environment", label: "Environment variable" },
            { value: "command", label: "Key manager command" },
          ]}
        />
        {credential === "environment" ? (
          <TextInput
            label="Environment variable"
            value={variable}
            onChange={setVariable}
          />
        ) : (
          <TextInput
            label={credential === "command" ? "Key helper command" : "API key"}
            type="password"
            value={value}
            onChange={setValue}
            placeholder={
              saved?.credential.type === credential
                ? "Saved. Leave blank to keep it."
                : credential === "command"
                  ? "Command supplied by your key manager"
                  : "Enter your key"
            }
          />
        )}
        <Text type="supporting">
          {credential === "command"
            ? "The saved command runs on this Mac at the start of a request. It must print only the API key. Nerilo does not store the returned key."
            : credential === "environment"
              ? "Nerilo reads this variable on the machine running the agent. Restart Nerilo after changing it."
              : "Stored in Nerilo’s private local connection file. Saved keys are never returned to the browser."}
        </Text>
        <details className="gateway-advanced">
          <summary>Advanced connection settings</summary>
          <div className="form-stack">
            <Selector
              label="Authentication header"
              value={authHeader}
              onChange={setAuthHeader}
              options={[
                { value: "authorization", label: "Authorization: Bearer" },
                { value: "x-api-key", label: "x-api-key" },
              ]}
            />
            <TextArea
              label="Custom headers"
              value={headers}
              onChange={setHeaders}
              placeholder="x-portkey-provider: @your-provider"
              rows={3}
            />
            {Boolean(saved?.headerNames.length) && (
              <div className="gateway-saved">
                <Text type="supporting">
                  {replaceHeaders
                    ? "Saved headers will be replaced."
                    : `Saved: ${saved!.headerNames.join(", ")}. Leave blank to keep them.`}
                </Text>
                <Button
                  label="Clear saved headers"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setHeaders("");
                    setReplaceHeaders(true);
                  }}
                />
              </div>
            )}
            {provider === "claude" && (
              <TextArea
                label="Model aliases and agent options"
                value={env}
                onChange={setEnv}
                rows={4}
                placeholder="ANTHROPIC_DEFAULT_OPUS_MODEL=@your-provider/your-model"
              />
            )}
            <TextArea
              label="Company CA certificate (PEM)"
              value={certificate}
              onChange={setCertificate}
              rows={3}
              placeholder="Only needed if your company uses a private certificate authority"
            />
            {saved?.hasCertificate && (
              <div className="gateway-saved">
                <Text type="supporting">
                  {replaceCertificate
                    ? "Saved certificate will be removed."
                    : "A certificate is saved. Leave blank to keep it."}
                </Text>
                <Button
                  label="Remove certificate"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCertificate("");
                    setReplaceCertificate(true);
                  }}
                />
              </div>
            )}
          </div>
        </details>
      </>
      {notice && (
        <div className="success-note" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="error-note" role="alert">
          {error}
        </div>
      )}
    </Modal>
  );
}
