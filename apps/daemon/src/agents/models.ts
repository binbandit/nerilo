import {
  defaultHarnessModels,
  isMultiProviderHarness,
  modelProviderSchema,
} from "@nerilo/protocol";
import { harnessKeys } from "./credentials";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import {
  effortSchema,
  modelCatalogSchema,
  type Execution,
  type ModelCatalog,
} from "@nerilo/protocol";
import { command, dataDir } from "../platform/config";
import type { Store } from "../platform/store";
import { activeGateway } from "./credentials";

const cachedModel = z.object({
  slug: z.string(),
  display_name: z.string(),
  visibility: z.string(),
  supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
  default_reasoning_level: z.string(),
});
// Bootstrap choices for a new installation. Discovered catalogs replace these
// so the picker follows the models and effort levels advertised by Codex.
const defaultCodexModels: ModelCatalog["codex"] = [
  {
    id: "gpt-6-astra",
    name: "GPT-6-Astra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.6-sol",
    name: "GPT-5.6-Sol",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "low",
  },
  {
    id: "gpt-5.6-terra",
    name: "GPT-5.6-Terra",
    efforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.6-luna",
    name: "GPT-5.6-Luna",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    defaultEffort: "medium",
  },
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    efforts: ["low", "medium", "high", "xhigh"],
    defaultEffort: "medium",
  },
];

async function readCodexCache(path: string): Promise<ModelCatalog["codex"]> {
  const cache = z
    .object({ models: z.array(z.unknown()) })
    .parse(JSON.parse(await readFile(path, "utf8")));
  return cache.models.flatMap((entry) => {
    const parsed = cachedModel.safeParse(entry);
    if (!parsed.success || parsed.data.visibility !== "list") return [];
    const model = parsed.data;
    return [
      {
        id: model.slug,
        name: model.display_name,
        efforts: model.supported_reasoning_levels.flatMap(({ effort }) => {
          const parsed = effortSchema.safeParse(effort);
          return parsed.success && parsed.data ? [parsed.data] : [];
        }),
        defaultEffort:
          effortSchema.safeParse(model.default_reasoning_level).data ?? "",
      },
    ];
  });
}

export async function modelCatalog(store?: Store): Promise<ModelCatalog> {
  const gateways = {
    codex: activeGateway("codex"),
    claude: activeGateway("claude"),
  };
  const path = join(dataDir, "codex-models.json");
  let codex = defaultCodexModels;
  try {
    const local = await readCodexCache(
      join(
        process.env.CODEX_HOME ?? join(homedir(), ".codex"),
        "models_cache.json",
      ),
    );
    if (local.length) codex = local;
  } catch {}
  try {
    const saved = modelCatalogSchema.shape.codex.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
    if (saved.length) codex = saved;
  } catch {}
  const recent = store
    ?.all("turn")
    .reverse()
    .find(
      (turn) =>
        (turn.execution?.provider ??
          store.get("task", turn.taskId)?.provider) === "codex",
    );
  if (recent && !gateways.codex) {
    const temporary = await mkdtemp(join(dataDir, "models-"));
    try {
      const output = join(temporary, "cache.json");
      const copy = await command(
        [
          "docker",
          "cp",
          `${recent.container}:/home/node/.codex/models_cache.json`,
          output,
        ],
        { timeout: 5000 },
      );
      if (!copy.code) {
        const discovered = await readCodexCache(output);
        if (discovered.length) {
          codex = discovered;
          await writeFile(path, JSON.stringify(codex), { mode: 0o600 });
        }
      }
    } catch {
      /* Retain the last successful catalog when Docker is unavailable. */
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  const harnessModels = async (provider: "opencode" | "pi") => {
    const keys = await harnessKeys(provider);
    // Match the runner's provider priority, regardless of credential file order.
    return modelProviderSchema.options
      .filter((vendor) => keys[vendor])
      .map((vendor) => ({
        id: `${vendor}/${defaultHarnessModels[vendor]}`,
        name: `${vendor} · ${defaultHarnessModels[vendor]}`,
        efforts:
          provider === "pi"
            ? ([
                "none",
                "minimal",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
              ] as const)
            : (["low", "medium", "high"] as const),
        defaultEffort: "" as const,
      }))
      .map((model) => ({ ...model, efforts: [...model.efforts] }));
  };
  const [opencode, pi] = await Promise.all([
    harnessModels("opencode"),
    harnessModels("pi"),
  ]);
  return {
    defaults: {
      codex: {
        model: gateways.codex?.model ?? "",
        source: gateways.codex ? "gateway" : "agent",
      },
      claude: {
        model: gateways.claude?.model ?? "",
        source: gateways.claude ? "gateway" : "agent",
      },
      opencode: { model: opencode[0]?.id ?? "", source: "nerilo" },
      pi: { model: pi[0]?.id ?? "", source: "nerilo" },
    },
    opencode,
    pi,
    codex: gateways.codex
      ? [
          {
            id: gateways.codex.model,
            name: gateways.codex.model,
            efforts: [],
            defaultEffort: "",
          },
        ]
      : codex,
    claude: gateways.claude
      ? [
          ...new Set([
            gateways.claude.model,
            ...["OPUS", "SONNET", "HAIKU"]
              .filter(
                (alias) =>
                  gateways.claude?.env[`ANTHROPIC_DEFAULT_${alias}_MODEL`],
              )
              .map((alias) => alias.toLowerCase()),
          ]),
        ].map((model) => ({
          id: model,
          name: model,
          efforts: [],
          defaultEffort: "",
        }))
      : [
          {
            id: "claude-fable-5-1",
            name: "Fable 5.1",
            efforts: ["low", "medium", "high", "xhigh", "max"],
            defaultEffort: "high",
          },
          {
            id: "claude-fable-5",
            name: "Fable 5",
            efforts: ["low", "medium", "high", "xhigh", "max"],
            defaultEffort: "high",
          },
          {
            id: "opus",
            name: "Opus",
            efforts: ["low", "medium", "high", "xhigh", "max"],
            defaultEffort: "",
          },
          {
            id: "sonnet",
            name: "Sonnet",
            efforts: ["low", "medium", "high", "xhigh", "max"],
            defaultEffort: "",
          },
          { id: "haiku", name: "Haiku", efforts: [], defaultEffort: "" },
        ],
  };
}
export async function validateExecution(execution: Execution) {
  if (isMultiProviderHarness(execution.provider) && execution.model) {
    const [vendor, ...parts] = execution.model.split("/");
    if (
      !modelProviderSchema.safeParse(vendor).success ||
      !parts.join("/") ||
      /\s/.test(execution.model)
    )
      throw new Error(
        "Use a model ID in provider/model format (anthropic, openai, google or openrouter).",
      );
  }
  if (!execution.effort) return;
  const models = await modelCatalog();
  const known = models[execution.provider].find(
    (model) => model.id === execution.model,
  );
  const allowed =
    known?.efforts ??
    (execution.provider === "pi"
      ? ["none", "minimal", "low", "medium", "high", "xhigh", "max"]
      : execution.provider === "opencode"
        ? ["low", "medium", "high", "xhigh", "max"]
        : execution.provider === "codex"
          ? [
              "none",
              "minimal",
              "low",
              "medium",
              "high",
              "xhigh",
              "max",
              "ultra",
            ]
          : ["low", "medium", "high", "xhigh", "max"]);
  if (!allowed.includes(execution.effort))
    throw new Error(
      "This effort level is not supported by the selected model.",
    );
}
