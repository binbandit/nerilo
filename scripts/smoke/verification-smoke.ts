import "../testing/setup";
import {
  checked,
  command,
  imageTag,
} from "../../apps/daemon/src/platform/config";
import { turnSchema, sandboxDefaults } from "../../packages/protocol/src/index";
import { reconcileVerification } from "../../apps/daemon/src/tasks/verification";

const taskId = crypto.randomUUID();
const id = crypto.randomUUID();
const volume = `nerilo-work-${taskId}`;
const container = `nerilo-check-proof-${id}`;
const readOnlyContainer = `${container}-readonly`;
try {
  const head = await checked([
    "docker",
    "run",
    "--rm",
    "--mount",
    `type=volume,source=${volume},target=/work`,
    "--entrypoint",
    "sh",
    imageTag,
    "-lc",
    "mkdir -p /work/repo && cd /work/repo && git init -q && git config user.name Fixture && git config user.email fixture@example.test && printf 'base\\n' > README.md && git add . && git commit -qm Initial && git rev-parse HEAD",
  ]);
  const turn = turnSchema.parse({
    id,
    taskId,
    inputId: "input",
    prompt: "Fixture",
    status: "running",
    container: "unused-agent",
    cursor: 0,
    startedAt: "now",
    endedAt: null,
    sandbox: sandboxDefaults,
    check: {
      container,
      image: imageTag,
      command:
        'test ! -e /home/node/.claude/.credentials.json && test ! -e /home/node/.codex/auth.json && test -z "$ANTHROPIC_API_KEY" && test -z "$OPENAI_API_KEY" && printf \'changed\\n\' >> README.md && printf verified',
    },
    result: {
      exitCode: 0,
      sessionId: null,
      summary: "Finished.",
      diff: "",
      changes: [],
      verification: null,
      baseCommit: head,
      headCommit: head,
    },
  });
  let result = await reconcileVerification(turn);
  for (let i = 0; !result && i < 40; i++) {
    await Bun.sleep(200);
    result = await reconcileVerification(
      turnSchema.parse(JSON.parse(JSON.stringify(turn))),
    );
  }
  if (
    result?.verification?.exitCode !== 0 ||
    result.verification.output !== "verified" ||
    !result.diff.includes("+changed")
  )
    throw new Error("Credential-free durable verification failed.");
  const mounts = await checked([
    "docker",
    "inspect",
    "--format",
    "{{range .Mounts}}{{.Name}} {{end}}",
    container,
  ]);
  if (mounts.trim() !== volume)
    throw new Error("Verification received unexpected persistent mounts.");
  const readOnly = turnSchema.parse({
    ...turn,
    sandbox: { ...sandboxDefaults, workspace: "read-only" },
    check: {
      ...turn.check,
      container: readOnlyContainer,
      command: "test -s README.md && printf readonly",
    },
  });
  let readOnlyResult = await reconcileVerification(readOnly);
  for (let i = 0; !readOnlyResult && i < 40; i++) {
    await Bun.sleep(200);
    readOnlyResult = await reconcileVerification(readOnly);
  }
  if (
    readOnlyResult?.verification?.exitCode !== 0 ||
    readOnlyResult.verification.output !== "readonly" ||
    !readOnlyResult.diff.includes("+changed")
  )
    throw new Error("Verification could not capture a read-only workspace.");
  console.log(
    "Verification survived a fresh record read, had no agent credentials, and captured changes in writable and read-only workspaces.",
  );
} finally {
  await command(["docker", "rm", "-f", container, readOnlyContainer]);
  await command(["docker", "volume", "rm", volume]);
}
