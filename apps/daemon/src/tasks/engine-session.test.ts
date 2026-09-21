import { test, expect } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

test("Retry retains session resets until a replacement session actually starts", async () => {
  const root = await mkdtemp(join(tmpdir(), "nerilo-session-retry-"));
  try {
    const docker = join(root, "docker");
    await Bun.write(
      docker,
      `#!/bin/sh
case "$1" in
  image) echo sha256:fixture ;;
  create|start|rm) exit 0 ;;
  attach) for arg do last="$arg"; done; cat > "$NERILO_SESSION_CAPTURE/$last.json" ;;
  *) exit 1 ;;
esac
`,
    );
    await chmod(docker, 0o700);
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("./fixtures/session-probe.ts", import.meta.url)),
      ],
      {
        env: {
          ...process.env,
          PATH: `${root}:${process.env.PATH}`,
          NERILO_SESSION_CAPTURE: root,
          NERILO_DATA_DIR: join(root, "data"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    const results = z
      .array(
        z.object({
          name: z.string(),
          unchanged: z.string().nullable(),
          first: z.string().nullable(),
          retry: z.string().nullable(),
          repeatedRetry: z.string().nullable(),
          replacement: z.string().nullable(),
        }),
      )
      .parse(JSON.parse(stdout));
    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result).toEqual({
        name: result.name,
        unchanged: "original-session",
        first: null,
        retry: null,
        repeatedRetry: null,
        replacement: "replacement-session",
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
