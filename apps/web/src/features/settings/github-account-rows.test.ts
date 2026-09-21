import { expect, test } from "bun:test";
import { githubAccountRows } from "@/features/settings/github-account-rows";

test("environment and saved credentials for the same GitHub identity share one row without hiding either state", () => {
  const rows = githubAccountRows({
    hostname: "github.com",
    environmentToken: "GH_TOKEN",
    accounts: [
      { login: "binbandit", active: true, state: "success" },
      { login: "binbandit", active: false, state: "error" },
      { login: "sage-smudge", active: false, state: "success" },
      { login: "WastedHippie", active: false, state: "success" },
    ],
  });
  expect(rows).toHaveLength(3);
  expect(rows[0]).toEqual({
    login: "binbandit",
    active: true,
    state: "success",
    environment: true,
    savedState: "error",
  });
  expect(rows[1]).toMatchObject({
    login: "sage-smudge",
    active: false,
    savedState: "success",
  });
  const reversed = githubAccountRows({
    hostname: "github.com",
    environmentToken: "GH_TOKEN",
    accounts: [
      { login: "SavedUser", active: false, state: "success" },
      { login: "saveduser", active: true, state: "error" },
    ],
  });
  expect(reversed).toEqual([
    {
      login: "saveduser",
      active: true,
      state: "error",
      environment: true,
      savedState: "success",
    },
  ]);
});

test("normal saved-account switching retains the active account and availability", () => {
  expect(
    githubAccountRows({
      hostname: "github.com",
      environmentToken: null,
      accounts: [
        { login: "work", active: false, state: "success" },
        { login: "personal", active: true, state: "success" },
      ],
    }),
  ).toEqual([
    {
      login: "work",
      active: false,
      state: "success",
      environment: false,
      savedState: "success",
    },
    {
      login: "personal",
      active: true,
      state: "success",
      environment: false,
      savedState: "success",
    },
  ]);
});
