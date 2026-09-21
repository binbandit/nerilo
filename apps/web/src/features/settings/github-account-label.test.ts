import { expect, test } from "bun:test";
import { resolvedGithubLogin } from "@/features/settings/github-account-label";
import type { GithubAccounts } from "@nerilo/protocol";

test("acting account labels follow task, project, and machine precedence including environment authentication", () => {
  const accounts: GithubAccounts = {
    hosts: [
      {
        hostname: "github.com",
        environmentToken: "GH_TOKEN",
        accounts: [
          { login: "environment", active: true, state: "success" },
          { login: "saved", active: false, state: "success" },
        ],
      },
    ],
  };
  const selected = { hostname: "github.com", login: "task" };
  const inherited = { hostname: "github.com", login: "project" };
  expect(resolvedGithubLogin(null, null, accounts)).toBe("environment");
  expect(resolvedGithubLogin(null, inherited, accounts)).toBe("project");
  expect(resolvedGithubLogin(selected, inherited, accounts)).toBe("task");
  expect(resolvedGithubLogin(null, null, undefined)).toBeNull();
  accounts.hosts[0].accounts[0].state = "error";
  expect(resolvedGithubLogin(null, null, accounts)).toBeNull();
});
