import { afterEach, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import * as config from "../platform/config";
import {
  claudeCredentialLocation,
  importLocalClaude,
  portableClaudeCredentials,
  removeImportedClaude,
  canImportClaude,
} from "./claude-import";

const fixture = JSON.stringify({
  claudeAiOauth: {
    accessToken: "fixture-access",
    refreshToken: "fixture-refresh",
    expiresAt: 1900000000000,
    scopes: ["user:inference", "user:profile"],
    subscriptionType: "max",
  },
  unrelatedApiKey: "not-copied",
});
const mocks: ReturnType<typeof spyOn<typeof config, "command">>[] = [];
afterEach(() => mocks.splice(0).forEach((mock) => mock.mockRestore()));

test.skipIf(process.platform !== "darwin")(
  "a cleared Keychain account is not offered as an existing login",
  async () => {
    const mock = spyOn(config, "command").mockResolvedValue({
      code: 0,
      stdout: fixture,
      stderr: "",
    });
    mocks.push(mock);
    expect(await canImportClaude(true)).toBe(true);
    mock.mockResolvedValue({
      code: 0,
      stdout: fixture
        .replace('"fixture-access"', '""')
        .replace('"fixture-refresh"', '""'),
      stderr: "",
    });
    expect(await canImportClaude(true)).toBe(false);
  },
);

test("portable login keeps only the Claude OAuth record and rejects missing refresh credentials without leaking values", () => {
  const copied = JSON.parse(portableClaudeCredentials(fixture));
  expect(copied.claudeAiOauth.subscriptionType).toBe("max");
  expect(copied.unrelatedApiKey).toBeUndefined();
  for (const raw of [
    "private-invalid-token",
    "{}",
    fixture.replace('"fixture-refresh"', '""'),
    fixture.replace("user:inference", "other"),
  ]) {
    try {
      portableClaudeCredentials(raw);
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).toContain("could not be imported");
      expect(String(error)).not.toContain("fixture-access");
      expect(String(error)).not.toContain("private-invalid-token");
    }
  }
});

test("credential lookup targets exactly the current Claude Code service and configured directory", () => {
  expect(
    claudeCredentialLocation({ USER: "fixture" }, "/home/fixture"),
  ).toEqual({
    file: "/home/fixture/.claude/.credentials.json",
    service: "Claude Code-credentials",
    account: "fixture",
  });
  const directory = "/private/claude-config";
  const suffix = createHash("sha256")
    .update(directory)
    .digest("hex")
    .slice(0, 8);
  expect(
    claudeCredentialLocation(
      { USER: "fixture", CLAUDE_CONFIG_DIR: directory },
      "/home/fixture",
    ).service,
  ).toBe(`Claude Code-credentials-${suffix}`);
  expect(
    claudeCredentialLocation(
      {
        USER: "bad account",
        CLAUDE_CONFIG_DIR: directory,
        CLAUDE_SECURESTORAGE_CONFIG_DIR: "",
      },
      "/home/fixture",
    ),
  ).toEqual({
    file: "/home/fixture/.claude/.credentials.json",
    service: "Claude Code-credentials",
    account: "claude-code-user",
  });
});

test.skipIf(process.platform !== "darwin")(
  "import streams validated credentials privately to official CLI storage without changing the host",
  async () => {
    const calls: { args: string[]; input?: string }[] = [];
    const mock = spyOn(config, "command").mockImplementation(
      async (args, options = {}) => {
        calls.push({ args, input: options.input });
        return {
          stdout: args[0] === "security" ? fixture : "",
          stderr: "",
          code: 0,
        };
      },
    );
    mocks.push(mock);
    await importLocalClaude();
    const secretCalls = calls.filter((call) => call.input);
    expect(secretCalls).toHaveLength(2);
    expect(secretCalls.every((call) => call.args[0] === "docker")).toBe(true);
    expect(secretCalls[0].args.join(" ")).toContain("auth','status");
    expect(secretCalls[1].args.join(" ")).toContain("renameSync");
    expect(calls.flatMap((call) => call.args).join(" ")).not.toContain(
      "fixture-access",
    );
    expect(
      calls
        .filter((call) => call.args[0] === "security")
        .map((call) => call.args[1]),
    ).toEqual(["find-generic-password"]);
  },
);

test("disconnect only deletes the container credential copy and refuses while a container is using it", async () => {
  let active = false;
  const calls: string[][] = [];
  mocks.push(
    spyOn(config, "command").mockImplementation(async (args) => {
      calls.push(args);
      return {
        stdout: active && args[1] === "ps" ? "running-container" : "",
        stderr: "",
        code: 0,
      };
    }),
  );
  await removeImportedClaude();
  expect(calls.at(-1)?.join(" ")).toContain("rmSync");
  expect(calls.flat().join(" ")).not.toContain("logout");
  active = true;
  await expect(removeImportedClaude()).rejects.toThrow(
    "Wait for Claude Code tasks",
  );
  expect(calls.at(-1)?.[1]).toBe("ps");
});
