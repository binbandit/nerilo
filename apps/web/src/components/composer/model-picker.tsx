"use client";
import {
  describeExecution,
  effortLabel,
  providerNames,
} from "@nerilo/protocol";
import { Check } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSubMenu,
} from "@astryxdesign/core/DropdownMenu";
import {
  effortSchema,
  providerSchema,
  type Execution,
  type Runtime,
} from "@nerilo/protocol";
import { useQuery } from "@tanstack/react-query";
import { queries } from "@/lib/query-options";
import { useSession } from "@/lib/query-provider";
import { ProviderIcon } from "@/components/ui/provider-icon";
import { Modal } from "@/components/editors/editors";
import { Button, TextInput } from "@/components/ui/ui";

export function ModelPicker({
  value,
  onChange,
  running = false,
  connections,
}: {
  value: Execution;
  onChange: (value: Execution) => void | Promise<void>;
  running?: boolean;
  connections?: Runtime["connections"];
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const { machineId, ready } = useSession();
  const { data: catalog } = useQuery({
    ...queries.models(machineId),
    enabled: ready,
  });
  const [custom, setCustom] = useState(false);
  const [customID, setCustomID] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const models = catalog?.[value.provider] ?? [];
  const selection = describeExecution(value, catalog);
  const known = selection.knownModel;
  const efforts =
    known?.efforts ??
    (value.provider === "pi"
      ? (["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const)
      : (["low", "medium", "high", "xhigh", "max"] as const));
  const providerName = providerNames[value.provider];
  const modelName = selection.model;
  const save = async (next: Execution) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setOpen(false);
    setError("");
    try {
      await onChange(next);
      setCustom(false);
      requestAnimationFrame(() => triggerRef.current?.focus());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const chooseModel = (model: string) => {
    const supported = describeExecution({ ...value, model }, catalog).knownModel
      ?.efforts;
    void save({
      ...value,
      model,
      effort:
        supported && !supported.includes(value.effort) ? "" : value.effort,
    });
  };
  const option = (
    label: string,
    id: string,
    current: string,
    icon?: ReactNode,
    description?: string,
  ) => (
    <DropdownMenuRadioItem
      key={id}
      label={label}
      value={id}
      icon={icon}
      description={description}
      className="model-menu-option"
      endContent={
        <span className="model-menu-check" aria-hidden="true">
          {id === current && <Check size={13} />}
        </span>
      }
    />
  );
  const row = (label: string, current: string) => (
    <span className="model-menu-row">
      <span>{label}</span>
      <span className="model-menu-value" title={current}>
        {current}
      </span>
    </span>
  );
  return (
    <div
      className="model-picker"
      title={`${providerName} · ${modelName} · Effort: ${selection.effort}`}
      onClick={(event) => event.stopPropagation()}
    >
      <DropdownMenu
        isMenuOpen={open}
        onOpenChange={(next) => {
          if (!next || !saving.current) setOpen(next);
        }}
        placement="above"
        alignment="start"
        menuWidth={300}
        button={{
          ref: triggerRef,
          label: `${modelName} · ${value.effort ? selection.effort : `Effort by ${providerName}`}`,
          "aria-label": `Agent settings: ${providerName}, ${modelName}, effort: ${selection.effort}`,
          icon: busy ? (
            <span className="task-spinner" />
          ) : (
            <ProviderIcon provider={value.provider} />
          ),
          variant: "ghost",
          size: "sm",
          className: "model-picker-trigger",
          "aria-busy": busy,
        }}
      >
        <DropdownMenuSubMenu
          label={row("Provider", providerName)}
          menuWidth={210}
        >
          <DropdownMenuRadioGroup
            label="Provider"
            value={value.provider}
            onChange={(provider) =>
              void save({
                provider: providerSchema.parse(provider),
                model: "",
                effort: "",
              })
            }
          >
            {providerSchema.options.map((provider) =>
              option(
                providerNames[provider],
                provider,
                value.provider,
                <ProviderIcon provider={provider} />,
                connections && !connections[provider].ready
                  ? "Not connected"
                  : undefined,
              ),
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubMenu>
        <DropdownMenuSubMenu label={row("Model", modelName)} menuWidth={340}>
          <DropdownMenuRadioGroup
            label="Model"
            value={value.model}
            onChange={chooseModel}
          >
            {option(selection.automaticModel, "", value.model)}
            {models.map((model) => option(model.name, model.id, value.model))}
            {value.model &&
              !known &&
              option(value.model, value.model, value.model)}
          </DropdownMenuRadioGroup>
          <DropdownMenuItem
            className="model-menu-option"
            label="Custom model…"
            onClick={() => {
              setError("");
              setCustomID(value.model);
              setCustom(true);
            }}
          />
          <div className="model-menu-explanation">
            {selection.modelDescription}
          </div>
        </DropdownMenuSubMenu>
        <DropdownMenuSubMenu
          label={row("Effort", selection.effort)}
          menuWidth={340}
        >
          <DropdownMenuRadioGroup
            label="Effort"
            value={value.effort}
            onChange={(effort) =>
              void save({ ...value, effort: effortSchema.parse(effort) })
            }
          >
            {option(selection.automaticEffort, "", value.effort)}
            {efforts.map((effort) =>
              option(effortLabel(effort), effort, value.effort),
            )}
          </DropdownMenuRadioGroup>
          <div className="model-menu-explanation">
            {selection.effortDescription}
          </div>
        </DropdownMenuSubMenu>
        <div className="model-menu-hint">
          {running
            ? "Changes apply next turn"
            : "Choose a model or effort to override automatic selection"}
        </div>
      </DropdownMenu>
      {error && !custom && (
        <div role="alert" className="model-menu-error">
          {error}
        </div>
      )}
      {custom && (
        <Modal
          title="Custom model"
          onSubmit={() => {
            if (!busy && customID.trim()) chooseModel(customID.trim());
          }}
          width={340}
          onClose={() => {
            if (!busy) {
              setCustom(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }
          }}
          footer={
            <Button
              label="Use model"
              variant="primary"
              size="sm"
              isLoading={busy}
              isDisabled={busy || !customID.trim()}
              onClick={() => chooseModel(customID.trim())}
            />
          }
        >
          <TextInput
            label="Model ID"
            value={customID}
            onChange={setCustomID}
            hasAutoFocus
          />
          {error && (
            <div role="alert" className="model-menu-error">
              {error}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
