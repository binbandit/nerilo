import { describe, expect, test } from "bun:test";
import { modelCatalog, validateExecution } from "./models";

describe("Claude model selection", () => {
  test("Fable models expose the full supported effort range", async () => {
    const catalog = await modelCatalog();
    for (const id of ["claude-fable-5-1", "claude-fable-5"]) {
      const model = catalog.claude.find((entry) => entry.id === id);
      expect(model?.defaultEffort).toBe("high");
      expect(model?.efforts).toEqual(["low", "medium", "high", "xhigh", "max"]);
      for (const effort of ["xhigh", "max"] as const)
        await expect(
          validateExecution({ provider: "claude", model: id, effort }),
        ).resolves.toBeUndefined();
    }
  });

  test("rejects unsupported effort without rejecting custom Claude models", async () => {
    await expect(
      validateExecution({ provider: "claude", model: "haiku", effort: "high" }),
    ).rejects.toThrow("not supported");
    await expect(
      validateExecution({
        provider: "claude",
        model: "fable",
        effort: "ultra",
      }),
    ).rejects.toThrow("not supported");
    await expect(
      validateExecution({ provider: "claude", model: "fable", effort: "max" }),
    ).resolves.toBeUndefined();
  });
});
