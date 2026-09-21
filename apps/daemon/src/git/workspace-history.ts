import { join } from "node:path";
import { rm } from "node:fs/promises";
import { checked, command, imageTag } from "../platform/config";

/** Export only Git objects, never the workspace's configuration or executable hooks. */
export async function bundleWorkspaceHistory(
  taskId: string,
  expectedHead: string,
  directory: string,
) {
  if (!/^[a-zA-Z0-9-]+$/.test(taskId) || !/^[a-f0-9]{40}$/.test(expectedHead))
    throw new Error("The task revision is invalid.");
  const name = `nerilo-history-${crypto.randomUUID()}`;
  const volume = `nerilo-work-${taskId}`;
  const path = join(directory, "result.bundle");
  await checked(["docker", "volume", "inspect", volume]);
  try {
    await checked([
      "docker",
      "run",
      "-d",
      "--name",
      name,
      "--label",
      "dev.nerilo.managed=true",
      "--network=none",
      "--read-only",
      "--cap-drop=ALL",
      "--security-opt=no-new-privileges",
      "--user=node",
      "--pids-limit=32",
      "--memory=512m",
      "--cpus=1",
      "--tmpfs",
      "/tmp:rw,nosuid,size=1g,mode=1777",
      "--mount",
      `type=volume,source=${volume},target=/work,readonly,volume-nocopy`,
      "--entrypoint",
      "sleep",
      imageTag,
      "120",
    ]);
    const git = [
      "docker",
      "exec",
      name,
      "git",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-C",
      "/work/repo",
    ];
    if ((await checked([...git, "rev-parse", "HEAD"])) !== expectedHead)
      throw new Error(
        "The workspace revision changed. Run the task again and review its latest result before exporting.",
      );
    await checked([...git, "bundle", "create", "/tmp/result.bundle", "HEAD"], {
      timeout: 90000,
    });
    // Docker's archive API does not expose files inside this tmpfs mount.
    // Stream bytes directly; the normal command helper decodes stdout as text.
    const transfer = Bun.spawn(
      ["docker", "exec", name, "cat", "/tmp/result.bundle"],
      { stdin: "ignore", stdout: Bun.file(path), stderr: "pipe" },
    );
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      transfer.kill("SIGKILL");
    }, 90000);
    try {
      const [code, error] = await Promise.all([
        transfer.exited,
        new Response(transfer.stderr).text(),
      ]);
      if (code !== 0 || timedOut)
        throw new Error(
          timedOut
            ? "Exporting the workspace history timed out. Try again."
            : `Could not export workspace history: ${error.trim().slice(0, 2000)}`,
        );
    } finally {
      clearTimeout(timer);
    }
    return path;
  } catch (error) {
    await rm(path, { force: true });
    throw error;
  } finally {
    await command(["docker", "rm", "-f", name], { timeout: 5000 }).catch(
      () => {},
    );
  }
}
