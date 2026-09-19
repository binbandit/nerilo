import "./test-setup";
import { sandboxLimits } from "../apps/daemon/src/sandbox";
import { checked, command, imageTag } from "../apps/daemon/src/config";

const id = crypto.randomUUID();
const volume = `nerilo-sandbox-proof-${id}`;
const container = `nerilo-sandbox-proof-${id}`;
try {
  await checked([
    "docker",
    "run",
    "--rm",
    "--mount",
    `type=volume,source=${volume},target=/work`,
    "--entrypoint",
    "node",
    imageTag,
    "-e",
    "require('fs').writeFileSync('/work/protected.txt','saved')",
  ]);
  await checked([
    "docker",
    "create",
    "--name",
    container,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    ...sandboxLimits({
      workspace: "read-only",
      cpus: 0.5,
      memoryMB: 512,
      pids: 64,
    }),
    "--mount",
    `type=volume,source=${volume},target=/work,readonly`,
    "--entrypoint",
    "node",
    imageTag,
    "-e",
    "const fs=require('fs'); for (const action of [()=>fs.writeFileSync('/work/protected.txt','changed'),()=>fs.chmodSync('/work/protected.txt',0o777),()=>fs.writeFileSync('/work/new.txt','new')]) { let blocked=false; try { action(); } catch(e) { blocked=e.code==='EROFS'; } if(!blocked) process.exit(1); } if(fs.readFileSync('/work/protected.txt','utf8')!=='saved')process.exit(2); console.log('Read-only enforced')",
  ]);
  const [inspected] = JSON.parse(
    await checked(["docker", "inspect", container]),
  ) as Array<{
    HostConfig: { NanoCpus: number; Memory: number; PidsLimit: number };
    Mounts: Array<{ Destination: string; RW: boolean }>;
  }>;
  if (
    inspected.HostConfig.NanoCpus !== 500000000 ||
    inspected.HostConfig.Memory !== 512 * 1024 * 1024 ||
    inspected.HostConfig.PidsLimit !== 64 ||
    inspected.Mounts.find((mount) => mount.Destination === "/work")?.RW !==
      false
  )
    throw new Error("Docker limits were not applied.");
  const output = await checked(["docker", "start", "--attach", container]);
  if (!output.includes("Read-only enforced"))
    throw new Error("Read-only proof failed.");
  console.log(
    "Docker enforced read-only workspace, CPU, memory, and process limits.",
  );
} finally {
  await command(["docker", "rm", "-f", container]);
  await command(["docker", "volume", "rm", volume]);
}
