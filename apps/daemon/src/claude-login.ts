import { createHash } from "node:crypto";
import { z } from "zod";
import { readRequestText, RequestTooLargeError } from "@nerilo/protocol";
import { checked, command, dataDir, imageTag } from "./config";

export const claudeAuthVolume = `nerilo-claude-auth-${createHash("sha256").update(dataDir).digest("hex").slice(0, 12)}`;
const loginStateSchema = z.enum([
  "idle",
  "starting",
  "waiting",
  "connected",
  "failed",
]);
type LoginState = {
  state: z.infer<typeof loginStateSchema>;
  url: string | null;
  error: string | null;
};
let state: LoginState = { state: "idle", url: null, error: null };
let active: {
  id: string;
  process: ReturnType<typeof Bun.spawn>;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let statusCache: { checkedAt: number; loggedIn: boolean } | null = null;
let loginVersion = 0;
export function invalidateClaudeStatus() {
  statusCache = null;
}

export function claudeAuthorizationURL(output: string): string | null {
  for (const candidate of output.match(/https:\/\/[^\s<>\u001b]+/g) ?? []) {
    try {
      const url = new URL(candidate);
      if (
        (([
          "claude.ai",
          "console.anthropic.com",
          "platform.claude.com",
        ].includes(url.hostname) &&
          url.pathname === "/oauth/authorize") ||
          (url.hostname === "claude.com" &&
            url.pathname === "/cai/oauth/authorize")) &&
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password
      )
        return url.href;
    } catch {}
  }
  return null;
}

export function parseClaudeLoginStatus(output: string) {
  try {
    const result = z
      .object({ loggedIn: z.boolean(), authMethod: z.string().optional() })
      .safeParse(JSON.parse(output));
    return (
      result.success &&
      result.data.loggedIn &&
      result.data.authMethod === "claude.ai"
    );
  } catch {
    return false;
  }
}

async function ensureVolume(name: string, path: string) {
  const existing = await command(["docker", "volume", "inspect", name], {
    timeout: 4000,
  });
  if (existing.code === 0) return;
  await checked([
    "docker",
    "run",
    "--rm",
    "--user",
    "0",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--cap-add=CHOWN",
    "--security-opt=no-new-privileges",
    "--mount",
    `type=volume,source=${name},target=${path}`,
    "--entrypoint",
    "chown",
    imageTag,
    "1000:1000",
    path,
  ]);
}

export async function claudeLoginMounts(taskId?: string) {
  if (taskId && !/^[a-zA-Z0-9-]{1,80}$/.test(taskId))
    throw new Error("Invalid task identifier.");
  await ensureVolume(claudeAuthVolume, "/home/node/.claude");
  if (taskId)
    await ensureVolume(
      `nerilo-claude-projects-${taskId}`,
      "/home/node/.claude/projects",
    );
  return [
    "--mount",
    `type=volume,source=${claudeAuthVolume},target=/home/node/.claude`,
    ...(taskId
      ? [
          "--mount",
          `type=volume,source=nerilo-claude-projects-${taskId},target=/home/node/.claude/projects`,
        ]
      : [
          "--tmpfs",
          "/home/node/.claude/projects:rw,nosuid,size=64m,uid=1000,gid=1000",
        ]),
    ...[
      "debug",
      "todos",
      "tasks",
      "session-env",
      "file-history",
      "shell-snapshots",
      "plans",
    ].flatMap((directory) => [
      "--tmpfs",
      `/home/node/.claude/${directory}:rw,nosuid,size=16m,uid=1000,gid=1000`,
    ]),
  ];
}

export async function claudeNativeStatus(force = false) {
  if (!force && statusCache && Date.now() - statusCache.checkedAt < 10000)
    return statusCache.loggedIn;
  let loggedIn = false;
  try {
    const existing = await command(
      ["docker", "volume", "inspect", claudeAuthVolume],
      { timeout: 3000 },
    );
    if (existing.code === 0) {
      const output = await command(
        [
          "docker",
          "run",
          "--rm",
          "--network=none",
          "--read-only",
          "--cap-drop=ALL",
          "--security-opt=no-new-privileges",
          "--tmpfs",
          "/tmp:rw,nosuid,size=64m,mode=1777",
          "--tmpfs",
          "/home/node:rw,nosuid,size=64m,uid=1000,gid=1000",
          "--mount",
          `type=volume,source=${claudeAuthVolume},target=/home/node/.claude`,
          "--entrypoint",
          "timeout",
          imageTag,
          "6",
          "claude",
          "auth",
          "status",
          "--json",
        ],
        { timeout: 8000 },
      );
      if (output.code === 0) loggedIn = parseClaudeLoginStatus(output.stdout);
    }
  } catch {}
  statusCache = { checkedAt: Date.now(), loggedIn };
  return loggedIn;
}

export async function disconnectClaudeLogin() {
  await cancelLogin();
  // The official binary revokes/removes only its dedicated container login.
  const existing = await command(
    ["docker", "volume", "inspect", claudeAuthVolume],
    { timeout: 3000 },
  );
  if (existing.code === 0)
    await command(
      [
        "docker",
        "run",
        "--rm",
        "--read-only",
        "--cap-drop=ALL",
        "--security-opt=no-new-privileges",
        "--tmpfs",
        "/tmp:rw,nosuid,size=64m,mode=1777",
        "--tmpfs",
        "/home/node:rw,nosuid,size=64m,uid=1000,gid=1000",
        "--mount",
        `type=volume,source=${claudeAuthVolume},target=/home/node/.claude`,
        "--entrypoint",
        "timeout",
        imageTag,
        "8",
        "claude",
        "auth",
        "logout",
      ],
      { timeout: 10000 },
    );
  statusCache = null;
}

async function cancelLogin() {
  loginVersion++;
  const previous = active;
  active = null;
  state = { state: "idle", url: null, error: null };
  if (previous) {
    clearTimeout(previous.timer);
    previous.process.kill();
    await command(["docker", "rm", "-f", previous.id], { timeout: 5000 }).catch(
      () => {},
    );
  }
}

async function startLogin(onConnected: () => void) {
  if (active || state.state === "starting") return;
  const version = ++loginVersion;
  state = { state: "starting", url: null, error: null };
  const mounts = await claudeLoginMounts();
  if (version !== loginVersion) return;
  const id = `nerilo-claude-login-${crypto.randomUUID()}`;
  const process = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "-i",
      "--name",
      id,
      "--label",
      "dev.nerilo.managed=true",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--cpus=1",
      "--memory=1g",
      "--pids-limit=64",
      "--tmpfs",
      "/tmp:rw,nosuid,size=64m,mode=1777",
      "--tmpfs",
      "/home/node:rw,nosuid,size=64m,uid=1000,gid=1000",
      ...mounts,
      "--entrypoint",
      "timeout",
      imageTag,
      "600",
      "claude",
      "auth",
      "login",
      "--claudeai",
    ],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => {
    if (active?.id !== id) return;
    void cancelLogin().then(() => {
      state = {
        state: "failed",
        url: null,
        error: "Sign-in timed out. Try again.",
      };
    });
  }, 600000);
  active = { id, process, timer };
  const read = async (stream: ReadableStream<Uint8Array>) => {
    let output = "";
    for await (const chunk of stream) {
      output = (output + new TextDecoder().decode(chunk)).slice(-16000);
      const url = claudeAuthorizationURL(output);
      if (url && active?.id === id)
        state = { state: "waiting", url, error: null };
    }
  };
  void Promise.all([read(process.stdout), read(process.stderr), process.exited])
    .then(async ([, , code]) => {
      if (active?.id !== id) return;
      clearTimeout(timer);
      active = null;
      statusCache = null;
      const connected = code === 0 && (await claudeNativeStatus(true));
      if (version !== loginVersion) return;
      if (connected) {
        onConnected();
        state = { state: "connected", url: null, error: null };
      } else
        state = {
          state: "failed",
          url: null,
          error:
            "Claude Code could not finish signing in. Start again and use the code from the browser.",
        };
    })
    .catch(() => {
      if (active?.id === id) {
        clearTimeout(timer);
        active = null;
        state = {
          state: "failed",
          url: null,
          error:
            "Claude Code could not start sign-in. Check Docker and the agent environment.",
        };
        void command(["docker", "rm", "-f", id], { timeout: 5000 }).catch(
          () => {},
        );
      }
    });
}

export async function handleClaudeLogin(
  request: Request,
  onConnected: () => void,
) {
  if (new URL(request.url).pathname !== "/connections/claude/login")
    return null;
  try {
    if (request.method === "POST") {
      const raw = await readRequestText(request, 8000);
      const input = z
        .discriminatedUnion("action", [
          z.object({ action: z.literal("start") }),
          z.object({ action: z.literal("cancel") }),
          z.object({
            action: z.literal("code"),
            code: z
              .string()
              .trim()
              .min(1)
              .max(4000)
              .regex(/^[^\r\n\x00-\x1f]+$/),
          }),
        ])
        .parse(JSON.parse(raw));
      if (input.action === "start") await startLogin(onConnected);
      if (input.action === "cancel") await cancelLogin();
      if (input.action === "code") {
        const stdin = active?.process.stdin;
        if (!stdin || typeof stdin === "number" || state.state !== "waiting")
          throw new Error("Start Claude sign-in before entering a code.");
        stdin.write(input.code + "\n");
        stdin.flush();
      }
    } else if (request.method !== "GET")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (state.state === "starting")
      state = {
        state: "failed",
        url: null,
        error:
          "Claude Code could not start sign-in. Check Docker and the agent environment.",
      };
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? "Enter the sign-in code shown by Claude."
            : error instanceof Error
              ? error.message
              : "Sign-in failed.",
      },
      { status: error instanceof RequestTooLargeError ? 413 : 400 },
    );
  }
}
