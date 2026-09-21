import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readRequestText } from "@nerilo/protocol";
import { command, checked, dataDir, imageTag } from "../platform/config";

type LoginState = {
  state: "idle" | "starting" | "waiting" | "connected" | "failed";
  url: string | null;
  deviceCode: string | null;
  error: string | null;
};
const idle: LoginState = {
  state: "idle",
  url: null,
  deviceCode: null,
  error: null,
};
let state = { ...idle };
let active: {
  id: string;
  process: ReturnType<typeof Bun.spawn>;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let version = 0;
export function codexDevicePrompt(text: string) {
  const plain = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const code = /^\s*([A-Z0-9]{3,6}-[A-Z0-9]{3,6})\s*$/m.exec(plain)?.[1];
  const url = plain.match(
    /https:\/\/auth\.openai\.com\/codex\/device(?=\s|$)/,
  )?.[0];
  return code && url ? { url, deviceCode: code } : null;
}
async function cleanup(id: string) {
  await command(["docker", "rm", "-f", id], { timeout: 5000 }).catch(() => {});
  await command(["docker", "volume", "rm", `${id}-home`], {
    timeout: 5000,
  }).catch(() => {});
}
export async function cancelCodexLogin() {
  version++;
  const previous = active;
  active = null;
  state = { ...idle };
  if (previous) {
    clearTimeout(previous.timer);
    previous.process.kill();
    await cleanup(previous.id);
  }
}
async function start(onConnected: (auth: unknown) => void) {
  if (active || state.state === "starting") return;
  const generation = ++version;
  state = { ...idle, state: "starting" };
  const id = `nerilo-codex-login-${crypto.randomUUID()}`;
  const child = Bun.spawn(
    [
      "docker",
      "run",
      "--name",
      id,
      "--label",
      "dev.nerilo.managed=true",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--cpus=1",
      "--memory=512m",
      "--pids-limit=64",
      "--tmpfs",
      "/tmp:rw,nosuid,size=64m,mode=1777",
      "--mount",
      `type=volume,source=${id}-home,target=/home/node`,
      "--entrypoint",
      "sh",
      imageTag,
      "-c",
      'mkdir -p "$CODEX_HOME" && timeout 600 codex login --device-auth',
    ],
    { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => {
    if (active?.id !== id) return;
    void cancelCodexLogin().then(() => {
      if (version === generation + 1)
        state = {
          ...idle,
          state: "failed",
          error: "Sign-in timed out. Start again to get a new code.",
        };
    });
  }, 610000);
  active = { id, process: child, timer };
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    let text = "";
    for await (const chunk of stream) {
      text = (text + decoder.decode(chunk, { stream: true })).slice(-16000);
      const prompt = codexDevicePrompt(text);
      if (prompt && active?.id === id)
        state = { ...idle, state: "waiting", ...prompt };
    }
  };
  void Promise.all([read(child.stdout), read(child.stderr), child.exited])
    .then(async ([, , code]) => {
      if (version !== generation) return;
      if (code !== 0) throw new Error();
      const temporary = await mkdtemp(join(dataDir, "codex-login-"));
      try {
        const path = join(temporary, "auth.json");
        await checked([
          "docker",
          "cp",
          `${id}:/home/node/.codex/auth.json`,
          path,
        ]);
        const auth: unknown = JSON.parse(await readFile(path, "utf8"));
        if (version !== generation) return;
        onConnected(auth);
        state = { ...idle, state: "connected" };
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    })
    .catch(() => {
      if (version === generation)
        state = {
          ...idle,
          state: "failed",
          error:
            "Codex could not finish sign-in. Check Docker, and enable device-code authentication in your ChatGPT security settings if required.",
        };
    })
    .finally(async () => {
      clearTimeout(timer);
      if (active?.id === id) active = null;
      await cleanup(id);
    });
}
export async function handleCodexLogin(
  request: Request,
  onConnected: (auth: unknown) => void,
) {
  if (new URL(request.url).pathname !== "/connections/codex/login") return null;
  try {
    if (request.method === "POST") {
      const input = z
        .object({ action: z.enum(["start", "cancel"]) })
        .parse(JSON.parse(await readRequestText(request, 1000)));
      if (input.action === "start") await start(onConnected);
      else await cancelCodexLogin();
    } else if (request.method !== "GET")
      return Response.json({ error: "Method not allowed" }, { status: 405 });
    return Response.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch {
    state = {
      ...idle,
      state: "failed",
      error:
        "Codex sign-in could not start. Prepare the agent environment and try again.",
    };
    return Response.json({ error: state.error }, { status: 400 });
  }
}
