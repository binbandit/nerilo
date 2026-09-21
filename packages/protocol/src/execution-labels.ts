import type { Execution, ModelCatalog } from "./index";
import { providerNames } from "./providers";

export const effortLabel = (effort: Execution["effort"]) =>
  effort === "xhigh"
    ? "Extra high"
    : effort.charAt(0).toUpperCase() + effort.slice(1);

/** Describes requested settings, without treating catalog suggestions as runtime facts. */
export function describeExecution(value: Execution, catalog?: ModelCatalog) {
  const provider = providerNames[value.provider];
  const inherited = catalog?.defaults?.[value.provider];
  const models = catalog?.[value.provider] ?? [];
  const model = models.find(
    (entry) => entry.id === (value.model || inherited?.model),
  );
  const inheritedName =
    models.find((entry) => entry.id === inherited?.model)?.name ??
    inherited?.model;
  let automaticModel = "Automatic model (unresolved)";
  let modelDescription =
    "The automatic model and its source are unavailable. Choose a model in this menu to set it explicitly.";
  if (inherited?.source === "gateway") {
    automaticModel = `${inheritedName} · Gateway`;
    modelDescription = `From your saved company gateway. Change it in Settings → Connections → ${provider} → Edit company gateway, or choose a model in this menu to override it.`;
  } else if (inherited?.source === "nerilo") {
    automaticModel = inheritedName
      ? `${inheritedName} · Nerilo`
      : "Connect a model provider";
    modelDescription = inheritedName
      ? "Built into Nerilo for the first connected provider in this order: Anthropic, OpenAI, Google, OpenRouter. There is no global model preference; choose a model in this menu to override it."
      : "No model provider is connected. Add an API key in Settings → Connections, then choose a model here.";
  } else if (inherited?.source === "agent") {
    automaticModel = `${provider} chooses`;
    modelDescription = `${provider} selects the model at runtime; Nerilo cannot resolve it in advance. Your local CLI model preferences are not imported. Choose a model in this menu to override it.`;
  }
  const noEffort = model?.efforts.length === 0;
  const automaticEffort = noEffort ? "Agent-managed" : `${provider} chooses`;
  const recommendation = model?.defaultEffort
    ? `The model catalog recommends ${effortLabel(model.defaultEffort)}. `
    : "";
  const effortDescription = noEffort
    ? `This catalog does not advertise adjustable effort for this model. ${provider} controls its behavior; Nerilo sends no effort override.`
    : `${recommendation}With no override, ${provider} selects the effort at runtime; the exact level is not reported here. Choose a level in this menu to set it explicitly. There is no global effort preference in Nerilo.`;
  return {
    model: value.model ? (model?.name ?? value.model) : automaticModel,
    effort: value.effort ? effortLabel(value.effort) : automaticEffort,
    automaticModel,
    automaticEffort,
    modelDescription,
    effortDescription,
    knownModel: model,
  };
}
