import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { command, imageTag } from "../platform/config";
import {
  claudeAuthVolume,
  claudeLoginMounts,
  invalidateClaudeStatus,
} from "./claude-login";

const secret = z
  .string()
  .min(1)
  .max(16000)
  .regex(/^[^\s\x00-\x1f]+$/);
const oauthSchema = z
  .object({
    accessToken: secret,
    refreshToken: secret,
    expiresAt: z.number().finite().positive(),
    scopes: z.array(z.string().max(200)).max(50),
  })
  .passthrough();

export function portableClaudeCredentials(raw: string) {
  try {
    if (raw.length > 64000) throw new Error();
    const data = z
      .object({ claudeAiOauth: oauthSchema })
      .parse(JSON.parse(raw));
    if (!data.claudeAiOauth.scopes.includes("user:inference"))
      throw new Error();
    return JSON.stringify(data);
  } catch {
    throw new Error(
      "The existing Claude Code login could not be imported. Sign in to Claude Code on this device, then try again.",
    );
  }
}

export function claudeCredentialLocation(env = process.env, home = homedir()) {
  const secure = env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const config =
    secure !== undefined
      ? secure || join(home, ".claude")
      : env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const directory = resolve(config).normalize("NFC");
  const custom =
    secure !== undefined ? Boolean(secure) : Boolean(env.CLAUDE_CONFIG_DIR);
  const suffix = custom
    ? `-${createHash("sha256").update(directory).digest("hex").slice(0, 8)}`
    : "";
  const name = env.USER || userInfo().username;
  return {
    file: join(directory, ".credentials.json"),
    service: `Claude Code-credentials${suffix}`,
    account: /^[a-zA-Z0-9._-]+$/.test(name) ? name : "claude-code-user",
  };
}
let availability: { at: number; ready: boolean } | null = null;
export async function canImportClaude(force = false) {
  if (!force && availability && Date.now() - availability.at < 30000)
    return availability.ready;
  let ready = false;
  try {
    await readLocalClaude();
    ready = true;
  } catch {}
  availability = { at: Date.now(), ready };
  return ready;
}

async function readLocalClaude() {
  const source = claudeCredentialLocation();
  // Match Claude Code's Keychain-first lookup. Never inspect unrelated services.
  if (process.platform === "darwin") {
    const result = await command(
      [
        "security",
        "find-generic-password",
        "-s",
        source.service,
        "-a",
        source.account,
        "-w",
      ],
      { timeout: 15000 },
    );
    if (result.code === 0)
      return portableClaudeCredentials(result.stdout.trim());
  }
  if (existsSync(source.file))
    return portableClaudeCredentials(readFileSync(source.file, "utf8"));
  throw new Error(
    "No existing Claude Code login could be read. Unlock your Keychain or sign in to Claude Code on this device, then try again.",
  );
}

const writeCredentials = `const fs=require('node:fs'); const raw=fs.readFileSync(0,'utf8'); const dir='/home/node/.claude'; fs.mkdirSync(dir,{recursive:true,mode:448}); const tmp=dir+'/.credentials-import-'+process.pid; fs.writeFileSync(tmp,raw,{mode:384,flag:'wx'}); fs.renameSync(tmp,dir+'/.credentials.json');`;
export async function assertClaudeAuthIdle() {
  const result = await command(
    [
      "docker",
      "ps",
      "--filter",
      `volume=${claudeAuthVolume}`,
      "--format",
      "{{.ID}}",
    ],
    { timeout: 5000 },
  );
  if (result.code !== 0)
    throw new Error(
      "Open Docker Desktop before importing your Claude Code login.",
    );
  if (result.stdout.trim())
    throw new Error(
      "Wait for Claude Code tasks or sign-in to finish before changing this login.",
    );
}
let importing = false;
export async function importLocalClaude() {
  if (importing)
    throw new Error("The Claude Code login is already being imported.");
  importing = true;
  try {
    await assertClaudeAuthIdle();
    const raw = await readLocalClaude();
    const base = [
      "docker",
      "run",
      "--rm",
      "--interactive",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--tmpfs",
      "/tmp:rw,nosuid,size=64m,mode=1777",
      "--tmpfs",
      "/home/node:rw,nosuid,size=64m,uid=1000,gid=1000",
    ];
    // Validate with the published CLI in ephemeral storage before replacing a connection.
    const validation = await command(
      [
        ...base,
        "--entrypoint",
        "timeout",
        imageTag,
        "8",
        "node",
        "-e",
        writeCredentials +
          ` const cp=require('node:child_process'); const r=cp.spawnSync('claude',['auth','status','--json'],{encoding:'utf8',timeout:6000}); try {const s=JSON.parse(r.stdout); if(r.status!==0||!s.loggedIn||s.authMethod!=='claude.ai')process.exit(1);}catch{process.exit(1);}`,
      ],
      { input: raw, timeout: 10000 },
    );
    if (validation.code !== 0)
      throw new Error(
        "Claude Code could not use the existing login. Sign in to Claude Code on this device and try again.",
      );
    const mounts = await claudeLoginMounts();
    await assertClaudeAuthIdle();
    const saved = await command(
      [
        ...base,
        ...mounts,
        "--entrypoint",
        "node",
        imageTag,
        "-e",
        writeCredentials,
      ],
      { input: raw, timeout: 8000 },
    );
    if (saved.code !== 0)
      throw new Error(
        "The Claude Code login could not be saved to its private container storage.",
      );
    invalidateClaudeStatus();
  } finally {
    importing = false;
  }
}

export async function removeImportedClaude() {
  await assertClaudeAuthIdle();
  const result = await command(
    [
      "docker",
      "run",
      "--rm",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--mount",
      `type=volume,source=${claudeAuthVolume},target=/home/node/.claude`,
      "--entrypoint",
      "node",
      imageTag,
      "-e",
      `require('node:fs').rmSync('/home/node/.claude/.credentials.json',{force:true})`,
    ],
    { timeout: 8000 },
  );
  if (result.code !== 0)
    throw new Error("The imported Claude Code login could not be removed.");
  invalidateClaudeStatus();
}
