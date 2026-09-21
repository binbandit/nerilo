import { expect, test } from "bun:test";
import { githubAccounts, switchGithubAccount } from "./github-accounts";
import type { command } from "../platform/config";

const entry = (login: string, active: boolean, extra = {}) => ({
  login,
  active,
  state: "success",
  tokenSource: "keyring",
  ...extra,
});
const status = (
  accounts = [entry("personal", true), entry("work", false)],
) => ({
  hosts: { "github.com": accounts },
});
const output = (value: unknown) => ({
  code: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});

test("account metadata includes all hosts without exposing tokens, paths or diagnostics", async () => {
  const result = await githubAccounts(async (args) => {
    expect(args).toEqual(["gh", "auth", "status", "--json", "hosts"]);
    return output({
      hosts: {
        "github.com": [
          entry("personal", true, {
            token: "secret-token",
            scopes: "repo",
            tokenSource: "/private/path/hosts.yml",
          }),
        ],
        "github.company.test": [
          entry("work", true, {
            state: "error",
            error: "secret diagnostic",
            token: "enterprise-token",
          }),
        ],
      },
    });
  });
  expect(result).toEqual({
    hosts: [
      {
        hostname: "github.com",
        environmentToken: null,
        accounts: [{ login: "personal", active: true, state: "success" }],
      },
      {
        hostname: "github.company.test",
        environmentToken: null,
        accounts: [{ login: "work", active: true, state: "error" }],
      },
    ],
  });
});

test("switches the explicitly selected host and user, then verifies the active login", async () => {
  const calls: string[][] = [];
  let active = "personal";
  const run: typeof command = async (args, options) => {
    calls.push(args);
    expect(options?.env?.GH_PROMPT_DISABLED).toBe("1");
    if (args[2] === "switch") active = "work";
    return output(
      status([
        entry("personal", active === "personal"),
        entry("work", active === "work"),
      ]),
    );
  };
  const updated = await switchGithubAccount(
    { hostname: "github.com", login: "work" },
    run,
  );
  expect(calls).toEqual([
    ["gh", "auth", "status", "--json", "hosts"],
    ["gh", "auth", "switch", "--hostname", "github.com", "--user", "work"],
    ["gh", "auth", "status", "--json", "hosts"],
  ]);
  expect(
    updated.hosts[0].accounts.find((account) => account.active)?.login,
  ).toBe("work");
});

test("environment authentication blocks switching only on its host", async () => {
  for (const tokenSource of [
    "GH_TOKEN",
    "GITHUB_TOKEN",
    "GH_ENTERPRISE_TOKEN",
    "GITHUB_ENTERPRISE_TOKEN",
  ]) {
    const calls: string[][] = [];
    await expect(
      switchGithubAccount(
        { hostname: "github.com", login: "work" },
        async (args) => {
          calls.push(args);
          return output(
            status([
              entry("personal", true, { tokenSource }),
              entry("work", false),
            ]),
          );
        },
      ),
    ).rejects.toThrow(tokenSource);
    expect(calls).toHaveLength(1);
  }
  let switched = false;
  const result = await switchGithubAccount(
    { hostname: "github.company.test", login: "work" },
    async (args) => {
      if (args[2] === "switch") switched = true;
      return output({
        hosts: {
          "github.com": [entry("personal", true, { tokenSource: "GH_TOKEN" })],
          "github.company.test": [
            entry("other", !switched),
            entry("work", switched),
          ],
        },
      });
    },
  );
  expect(result.hosts[1].accounts[1].active).toBe(true);
});

test("unknown or unhealthy saved accounts cannot trigger a switch", async () => {
  for (const accounts of [
    [],
    [entry("other", true)],
    [entry("work", false, { state: "error" })],
    [entry("work", false, { state: "timeout" })],
  ]) {
    const calls: string[][] = [];
    await expect(
      switchGithubAccount(
        { hostname: "github.com", login: "work" },
        async (args) => {
          calls.push(args);
          return output(status(accounts));
        },
      ),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);
  }
});

test("malformed account selections are rejected before invoking the CLI", async () => {
  for (const input of [
    {},
    { hostname: "--help", login: "work" },
    { hostname: "github.com", login: "$(whoami)" },
  ]) {
    let called = false;
    await expect(
      switchGithubAccount(input, async () => {
        called = true;
        return output(status());
      }),
    ).rejects.toThrow();
    expect(called).toBe(false);
  }
});

test("selecting the active account is a no-op and an empty login list is supported", async () => {
  let calls = 0;
  await switchGithubAccount(
    { hostname: "github.com", login: "personal" },
    async () => {
      calls++;
      return output(status());
    },
  );
  expect(calls).toBe(1);
  expect(await githubAccounts(async () => output({ hosts: {} }))).toEqual({
    hosts: [],
  });
});

test("CLI failures have actionable messages without returning raw output", async () => {
  await expect(
    githubAccounts(async () => {
      throw Object.assign(new Error("private path"), { code: "ENOENT" });
    }),
  ).rejects.toThrow("Install GitHub CLI");
  await expect(
    githubAccounts(async () => ({ code: 124, stdout: "", stderr: "secret" })),
  ).rejects.toThrow("too long");
  await expect(
    githubAccounts(async () => ({
      code: 1,
      stdout: "secret",
      stderr: "secret",
    })),
  ).rejects.toThrow("up to date");
  await expect(
    githubAccounts(async () => output({ token: "secret" })),
  ).rejects.toThrow("unexpected account status");
  await expect(
    githubAccounts(async () => ({
      code: 0,
      stdout: "not-json secret",
      stderr: "",
    })),
  ).rejects.toThrow("unexpected account status");
});

test("failed switches and unconfirmed switches never report success", async () => {
  await expect(
    switchGithubAccount(
      { hostname: "github.com", login: "work" },
      async (args) =>
        args[2] === "switch"
          ? { code: 1, stdout: "", stderr: "private diagnostic" }
          : output(status()),
    ),
  ).rejects.toThrow("Could not switch");
  await expect(
    switchGithubAccount({ hostname: "github.com", login: "work" }, async () =>
      output(status()),
    ),
  ).rejects.toThrow("did not confirm");
  let calls = 0;
  await expect(
    switchGithubAccount({ hostname: "github.com", login: "work" }, async () => {
      if (++calls === 3) return { code: 124, stdout: "", stderr: "" };
      return output(status());
    }),
  ).rejects.toThrow("accepted the switch");
});
