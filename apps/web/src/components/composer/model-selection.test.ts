import { expect, test } from "bun:test";
import { describeExecution, modelCatalogSchema } from "@nerilo/protocol";

const catalog = modelCatalogSchema.parse({
  codex: [
    {
      id: "catalog-first",
      name: "First in catalog",
      efforts: ["low", "high"],
      defaultEffort: "high",
    },
  ],
  claude: [
    {
      id: "company-model",
      name: "Company model",
      efforts: [],
      defaultEffort: "",
    },
  ],
  pi: [
    {
      id: "openai/model",
      name: "OpenAI model",
      efforts: ["low", "high"],
      defaultEffort: "",
    },
  ],
  defaults: {
    codex: { model: "", source: "agent" },
    claude: { model: "company-model", source: "gateway" },
    pi: { model: "openai/model", source: "nerilo" },
    opencode: { model: "", source: "nerilo" },
  },
});

test("automatic agent choices never infer a model from catalog ordering or an actual effort from a recommendation", () => {
  const automatic = describeExecution(
    { provider: "codex", model: "", effort: "" },
    catalog,
  );
  expect(automatic.model).toBe("Codex chooses");
  expect(automatic.knownModel).toBeUndefined();
  const selected = describeExecution(
    { provider: "codex", model: "catalog-first", effort: "" },
    catalog,
  );
  expect(selected.effort).toBe("Codex chooses");
  expect(selected.effortDescription).toContain("recommends High");
  expect(selected.effortDescription).toContain("exact level is not reported");
});

test("inherited models expose their source and explicit choices take precedence", () => {
  const gateway = describeExecution(
    { provider: "claude", model: "", effort: "" },
    catalog,
  );
  expect(gateway.model).toBe("Company model · Gateway");
  expect(gateway.modelDescription).toContain("Settings → Connections");
  expect(gateway.effort).toBe("Agent-managed");
  expect(gateway.knownModel?.efforts).toEqual([]);
  const fallback = describeExecution(
    { provider: "pi", model: "", effort: "" },
    catalog,
  );
  expect(fallback.model).toBe("OpenAI model · Nerilo");
  expect(fallback.knownModel?.efforts).toEqual(["low", "high"]);
  const explicit = describeExecution(
    { provider: "claude", model: "custom-model", effort: "xhigh" },
    catalog,
  );
  expect(explicit.model).toBe("custom-model");
  expect(explicit.effort).toBe("Extra high");
  expect(explicit.knownModel).toBeUndefined();
});

test("missing catalog metadata and missing credentials do not invent a resolved model", () => {
  const disconnected = describeExecution(
    { provider: "opencode", model: "", effort: "" },
    catalog,
  );
  expect(disconnected.model).toBe("Connect a model provider");
  expect(disconnected.modelDescription).toContain("Add an API key");
  const legacy = modelCatalogSchema.parse({ codex: catalog.codex, claude: [] });
  for (const unavailable of [undefined, legacy]) {
    const selection = describeExecution(
      { provider: "codex", model: "", effort: "" },
      unavailable,
    );
    expect(selection.knownModel).toBeUndefined();
    expect(selection.modelDescription).toContain("unavailable");
  }
});
