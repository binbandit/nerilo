import { expect, test } from "bun:test";
import { githubCommandEnvironment, withGithubAccount } from "./github-context";

const account = (login: string) => ({ hostname: "github.com", login });
const gh = ["gh", "api", "user"];
const tokenCommand = async (args: string[]) => ({
  code: 0,
  stdout: `fixture-token-${args.at(-1)}`,
  stderr: "",
});

test("concurrent GitHub operations retain independent accounts across awaits", async () => {
  const original = process.env.GH_TOKEN;
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  const first = withGithubAccount(account("personal"), async () => {
    const before = await githubCommandEnvironment(gh, tokenCommand);
    started.resolve();
    await release.promise;
    return [before, await githubCommandEnvironment(gh, tokenCommand)];
  });
  await started.promise;
  const second = await withGithubAccount(account("work"), () =>
    githubCommandEnvironment(gh, tokenCommand),
  );
  release.resolve();
  expect((await first).map((env) => env?.GH_TOKEN)).toEqual([
    "fixture-token-personal",
    "fixture-token-personal",
  ]);
  expect(second?.GH_TOKEN).toBe("fixture-token-work");
  expect(process.env.GH_TOKEN).toBe(original);
  expect(await githubCommandEnvironment(gh, tokenCommand)).toBeNull();
});

test("tokens are resolved once per operation from the named stored login and reused for HTTPS Git", async () => {
  const calls: string[][] = [];
  await withGithubAccount(account("work"), async () => {
    const run: Parameters<typeof githubCommandEnvironment>[1] = async (
      args,
      options,
    ) => {
      calls.push(args);
      expect(options.env.GH_TOKEN).toBe("");
      expect(options.env.GITHUB_TOKEN).toBe("");
      return tokenCommand(args);
    };
    const [api, git] = await Promise.all([
      githubCommandEnvironment(gh, run),
      githubCommandEnvironment(
        ["git", "-c", "credential.helper=!gh auth git-credential", "push"],
        run,
      ),
    ]);
    expect(api).toEqual(git);
    expect(api?.GH_HOST).toBe("github.com");
    expect(api?.GITHUB_TOKEN).toBe("");
  });
  expect(calls).toEqual([
    ["gh", "auth", "token", "--hostname", "github.com", "--user", "work"],
  ]);
});

test("default scopes, local Git, account management and unrelated tools do not resolve a token", async () => {
  const run = async () => {
    throw new Error("Must not look up a token");
  };
  await withGithubAccount(account("work"), async () => {
    for (const args of [
      ["docker", "create"],
      ["git", "status"],
      ["gh", "auth", "status"],
    ])
      expect(await githubCommandEnvironment(args, run)).toBeNull();
    expect(
      await withGithubAccount(null, () => githubCommandEnvironment(gh, run)),
    ).toBeNull();
  });
});

test("missing credentials fail closed and do not expose raw token lookup output", async () => {
  for (const run of [
    async () => ({
      code: 1,
      stdout: "private-token",
      stderr: "private-diagnostic",
    }),
    async () => ({ code: 0, stdout: "", stderr: "" }),
    async () => {
      throw new Error("private-token");
    },
  ]) {
    await expect(
      withGithubAccount(account("missing"), () =>
        githubCommandEnvironment(gh, run),
      ),
    ).rejects.toThrow("@missing is unavailable");
  }
  expect(() =>
    withGithubAccount({ hostname: "enterprise.test", login: "work" }, () => {}),
  ).toThrow();
});

test("the real command runner scopes child credentials and redacts echoed tokens", async () => {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/fixtures/github-context-probe.ts`],
    {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, stdout, stderr }).toEqual({
    code: 0,
    stdout: "Scoped command probe passed\n",
    stderr: "",
  });
});
