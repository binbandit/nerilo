import { expect, test } from "bun:test";
import type { GitRemoteStatus } from "@nerilo/protocol";
import { gitPublication } from "./git-publication";

const local = { branch: "nerilo/work", head: "a".repeat(40) };
const remote: GitRemoteStatus = {
  ...local,
  remoteHead: local.head,
  state: "synced",
  ahead: 0,
  behind: 0,
  checkedAt: "now",
  error: null,
};
test("publication is based on the checked revision, not prior push memory", () => {
  expect(gitPublication(local, remote).canOpenPR).toBe(true);
  expect(gitPublication(local, remote).canPush).toBe(false);
  for (const changed of [
    { ...local, head: "b".repeat(40) },
    { ...local, branch: "nerilo/new" },
  ]) {
    const result = gitPublication(changed, remote);
    expect(result.state).toBe("checking");
    expect(result.canOpenPR).toBe(false);
    expect(result.canPush).toBe(false);
  }
});
test("only unpublished and ahead branches offer push; failure and divergence never imply unpublished", () => {
  for (const state of ["unavailable", "behind", "diverged"] as const) {
    const result = gitPublication(local, {
      ...remote,
      state,
      ahead: 1,
      behind: 2,
      error: state === "unavailable" ? "Offline" : null,
    });
    expect(result.canPush).toBe(false);
    expect(result.canOpenPR).toBe(false);
  }
  expect(
    gitPublication(local, { ...remote, state: "unpublished", remoteHead: null })
      .canPush,
  ).toBe(true);
  const ahead = gitPublication(local, {
    ...remote,
    state: "ahead",
    remoteHead: "b".repeat(40),
    ahead: 2,
  });
  expect(ahead.canPush).toBe(true);
  expect(ahead.canOpenPR).toBe(false);
  expect(ahead.title).toBe("2 commits to push");
  expect(gitPublication(local, null).canPush).toBe(false);
});
