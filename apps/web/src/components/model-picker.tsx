"use client";
import { Check } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSubMenu,
} from "@astryxdesign/core/DropdownMenu";
import {
  effortSchema,
  modelCatalogSchema,
  providerSchema,
  type ModelCatalog,
  type Execution,
} from "@nerilo/protocol";
import { read } from "@/lib/api";
import { ProviderIcon } from "@/components/provider-icon";
import { Modal } from "@/components/editors";
import { Button, TextInput } from "@/components/ui";

const effortLabel = (effort: Execution["effort"]) =>
  !effort
    ? "Default"
    : effort === "xhigh"
      ? "Extra high"
      : effort.charAt(0).toUpperCase() + effort.slice(1);

export function ModelPicker({
  value,
  onChange,
  running = false,
}: {
  value: Execution;
  onChange: (value: Execution) => void | Promise<void>;
  running?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value);
  const [catalog, setCatalog] = useState<ModelCatalog>({
    codex: [],
    claude: [],
  });
  const [custom, setCustom] = useState(false);
  const [customID, setCustomID] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void read("models")
      .then((result) => setCatalog(modelCatalogSchema.parse(result)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    setSelected(value);
  }, [value.provider, value.model, value.effort]);
  const models = catalog[selected.provider];
  const known = models.find((model) => model.id === selected.model);
  const efforts =
    known?.efforts ?? (["low", "medium", "high", "xhigh", "max"] as const);
  const providerName = selected.provider === "codex" ? "Codex" : "Claude";
  const modelName = known?.name ?? (selected.model || "Default");
  const save = async (next: Execution) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setOpen(false);
    setError("");
    try {
      await onChange(next);
      setSelected(next);
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
    const supported = models.find((item) => item.id === model)?.efforts;
    void save({
      ...selected,
      model,
      effort:
        supported && !supported.includes(selected.effort)
          ? ""
          : selected.effort,
    });
  };
  const option = (
    label: string,
    id: string,
    current: string,
    icon?: ReactNode,
  ) => (
    <DropdownMenuRadioItem
      key={id}
      label={label}
      value={id}
      icon={icon}
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
    <div className="model-picker" onClick={(event) => event.stopPropagation()}>
      <DropdownMenu
        isMenuOpen={open}
        onOpenChange={(next) => {
          if (!next || !saving.current) setOpen(next);
        }}
        placement="above"
        alignment="start"
        menuWidth={248}
        button={{
          ref: triggerRef,
          label: `${selected.model ? modelName : providerName}${selected.effort ? ` · ${effortLabel(selected.effort)}` : ""}`,
          "aria-label": `Agent settings: ${providerName}, ${selected.model || "default model"}, ${selected.effort || "default"} effort`,
          icon: busy ? (
            <span className="task-spinner" />
          ) : (
            <ProviderIcon provider={selected.provider} />
          ),
          variant: "ghost",
          size: "sm",
          className: "model-picker-trigger",
          "aria-busy": busy,
        }}
      >
        <DropdownMenuSubMenu
          label={row("Provider", providerName)}
          menuWidth={180}
        >
          <DropdownMenuRadioGroup
            label="Provider"
            value={selected.provider}
            onChange={(provider) =>
              void save({
                provider: providerSchema.parse(provider),
                model: "",
                effort: "",
              })
            }
          >
            {option(
              "Codex",
              "codex",
              selected.provider,
              <ProviderIcon provider="codex" />,
            )}
            {option(
              "Claude",
              "claude",
              selected.provider,
              <ProviderIcon provider="claude" />,
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubMenu>
        <DropdownMenuSubMenu label={row("Model", modelName)} menuWidth={210}>
          <DropdownMenuRadioGroup
            label="Model"
            value={selected.model}
            onChange={chooseModel}
          >
            {option("Default", "", selected.model)}
            {models.map((model) =>
              option(model.name, model.id, selected.model),
            )}
            {selected.model &&
              !known &&
              option(selected.model, selected.model, selected.model)}
          </DropdownMenuRadioGroup>
          <DropdownMenuItem
            className="model-menu-option"
            label="Custom model…"
            onClick={() => {
              setError("");
              setCustomID(selected.model);
              setCustom(true);
            }}
          />
        </DropdownMenuSubMenu>
        <DropdownMenuSubMenu
          label={row("Effort", effortLabel(selected.effort))}
          menuWidth={180}
        >
          <DropdownMenuRadioGroup
            label="Effort"
            value={selected.effort}
            onChange={(effort) =>
              void save({ ...selected, effort: effortSchema.parse(effort) })
            }
          >
            {option("Default", "", selected.effort)}
            {efforts.map((effort) =>
              option(effortLabel(effort), effort, selected.effort),
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubMenu>
        {running && <div className="model-menu-hint">Next turn</div>}
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
