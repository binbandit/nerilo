import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command } from "../../platform/config";
import { withGithubAccount } from "../github-context";

const root = await mkdtemp(join(tmpdir(), "nerilo-github-command-"));
const bin = join(root, "bin");
try {
  await mkdir(bin);
  const script = `#!${process.execPath}
const args = process.argv.slice(2);
if (args[0] === 'auth' && args[1] === 'token') {
  if (args.at(-1) === 'missing') process.exit(1);
  console.log('fixture-token-' + args.at(-1));
} else if (args.includes('echo-token')) {
  console.log(process.env.GH_TOKEN);
  console.error(process.env.GH_TOKEN);
} else {
  await Bun.sleep(20);
  console.log((process.env.GH_TOKEN ?? 'machine').replace('fixture-token-', ''));
}
`;
  for (const name of ["gh", "git"])
    await writeFile(join(bin, name), script, { mode: 0o700 });
  process.env.PATH = `${bin}:${process.env.PATH}`;
  process.env.GH_TOKEN = "fixture-token-machine";
  process.env.GITHUB_TOKEN = "fixture-token-other";
  const scoped = (login: string) =>
    withGithubAccount({ hostname: "github.com", login }, async () => {
      const api = await command(["gh", "api", "user"], {
        env: { GH_TOKEN: "fixture-token-wrong" },
      });
      const git = await command([
        "git",
        "-c",
        "credential.helper=!gh auth git-credential",
        "push",
      ]);
      return [api.stdout.trim(), git.stdout.trim()];
    });
  assert.deepEqual(await Promise.all([scoped("personal"), scoped("work")]), [
    ["personal", "personal"],
    ["work", "work"],
  ]);
  assert.equal((await command(["gh", "api", "user"])).stdout.trim(), "machine");
  const redacted = await withGithubAccount(
    { hostname: "github.com", login: "work" },
    () => command(["gh", "api", "echo-token"]),
  );
  assert.equal(redacted.stdout.trim(), "[redacted]");
  assert.equal(redacted.stderr.trim(), "[redacted]");
  await assert.rejects(scoped("missing"), /@missing is unavailable/);
  assert.equal(process.env.GH_TOKEN, "fixture-token-machine");
  console.log("Scoped command probe passed");
} finally {
  await rm(root, { recursive: true, force: true });
}
