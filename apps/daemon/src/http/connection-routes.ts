import { providerSchema, modelProviderSchema } from "@nerilo/protocol";
import { switchGithubAccount } from "../git/github-accounts";
import { z } from "zod";
import { testConnection } from "../agents/ai-suggestions";
import {
  disconnect,
  importClaude,
  importCodex,
  importHarness,
  saveKey,
  selectGateway,
} from "../agents/credentials";
import { importedGateway, saveGateway } from "../agents/gateway";
import { command } from "../platform/config";
import { type ApiContext, json } from "./context";

export async function handleConnectionMutation(
  path: string,
  body: unknown,
  { engine }: ApiContext,
) {
  if (path === "/connections/github/switch")
    return json(await switchGithubAccount(body));
  if (path === "/runtime/build") {
    void engine.build();
    return json({ ok: true });
  }
  if (path === "/runtime/open-docker") {
    if (process.platform !== "darwin")
      throw new Error(
        "Start Docker on the machine running Nerilo, then try again.",
      );
    const result = await command(["open", "-a", "Docker"], {
      timeout: 5000,
    });
    if (result.code !== 0)
      throw new Error(
        "Install Docker Desktop, open it, and complete its setup. Nerilo will detect it automatically.",
      );
    return json({ ok: true });
  }
  if (path === "/connections") {
    const input = z
      .object({
        provider: providerSchema,
        action: z.enum(["key", "import", "disconnect"]),
        key: z.string().optional(),
        modelProvider: modelProviderSchema.default("anthropic"),
      })
      .parse(body);
    if (input.action === "import") {
      if (input.provider === "codex") importCodex();
      else if (input.provider === "claude") await importClaude();
      else importHarness(input.provider);
    }
    if (input.action === "key")
      await saveKey(
        input.provider,
        z.string().min(1).parse(input.key),
        input.modelProvider,
      );
    if (input.action === "disconnect") await disconnect(input.provider);
    return json(await engine.runtime(true));
  }
  const test = /^\/connections\/(opencode|pi)\/test$/.exec(path);
  if (test) return json(await testConnection(providerSchema.parse(test[1])));
  const gateway =
    /^\/connections\/(codex|claude)\/(gateway|gateway-import|test)$/.exec(path);
  if (gateway) {
    const provider = providerSchema.parse(gateway[1]);
    if (gateway[2] === "test") return json(await testConnection(provider));
    const view = saveGateway(
      provider,
      gateway[2] === "gateway-import" ? importedGateway(provider) : body,
    );
    selectGateway(provider);
    await engine.runtime(true);
    return json(view);
  }
}
