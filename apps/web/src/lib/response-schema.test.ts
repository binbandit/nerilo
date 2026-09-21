import { expect, test } from "bun:test";
import { providerSchema } from "@nerilo/protocol";
import {
  needsAppReload,
  parseApiResponse,
  ResponseSchemaError,
} from "@/lib/response-schema";

test("an unsupported provider response requests app reload without exposing schema internals", () => {
  let failure: unknown;
  try {
    parseApiResponse(
      providerSchema.parse,
      "a-provider-added-by-a-newer-daemon",
    );
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(ResponseSchemaError);
  expect(needsAppReload(failure)).toBe(true);
  expect((failure as Error).message).toContain("Reload the app");
  expect((failure as Error).message).not.toContain("invalid_value");
  expect((failure as Error).message).not.toContain(
    "a-provider-added-by-a-newer-daemon",
  );
});

test("ordinary failures keep their existing recovery and valid responses parse normally", () => {
  const offline = new TypeError("Network unavailable");
  expect(needsAppReload(offline)).toBe(false);
  expect(() =>
    parseApiResponse(() => {
      throw offline;
    }, null),
  ).toThrow(offline);
  expect(parseApiResponse(providerSchema.parse, "codex")).toBe("codex");
});
