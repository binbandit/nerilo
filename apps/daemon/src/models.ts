import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  effortSchema,
  modelCatalogSchema,
  type Execution,
  type ModelCatalog,
} from "@nerilo/protocol";
import { command, dataDir } from "./config";
import type { Store } from "./store";
import { activeGateway } from "./credentials";

const cachedModel = z.object({
  slug: z.string(),
  display_name: z.string(),
  visibility: z.string(),
  supported_reasoning_levels: z.array(z.object({ effort: z.string() })),
  default_reasoning_level: z.string(),
});
export async function modelCatalog(store?: Store): Promise<ModelCatalog> {
  const gateways = {
    codex: activeGateway("codex"),
    claude: activeGateway("claude"),
  };
  const path = join(dataDir, "codex-models.json");
  let codex: ModelCatalog["codex"] = [];
  try {
    codex = modelCatalogSchema.shape.codex.parse(
      JSON.parse(await readFile(path, "utf8")),
    );
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
        const cache = z
          .object({ models: z.array(cachedModel) })
          .parse(JSON.parse(await readFile(output, "utf8")));
        codex = cache.models
          .filter((model) => model.visibility === "list")
          .map((model) => ({
            id: model.slug,
            name: model.display_name,
            efforts: model.supported_reasoning_levels.flatMap(({ effort }) => {
              const parsed = effortSchema.safeParse(effort);
              return parsed.success ? [parsed.data] : [];
            }),
            defaultEffort:
              effortSchema.safeParse(model.default_reasoning_level).data ?? "",
          }));
        await writeFile(path, JSON.stringify(codex), { mode: 0o600 });
      }
    } catch {
      /* Retain the last successful catalog when Docker is unavailable. */
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  return {
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
  if (!execution.effort) return;
  const models = await modelCatalog();
  const known = models[execution.provider].find(
    (model) => model.id === execution.model,
  );
  const allowed =
    known?.efforts ??
    (execution.provider === "codex"
      ? ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
      : ["low", "medium", "high", "xhigh", "max"]);
  if (!allowed.includes(execution.effort))
    throw new Error(
      "This effort level is not supported by the selected model.",
    );
}
