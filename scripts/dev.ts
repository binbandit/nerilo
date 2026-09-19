const children = [
  Bun.spawn(["bun", "apps/daemon/src/index.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
  Bun.spawn(
    [
      "bun",
      "--bun",
      "apps/web/node_modules/next/dist/bin/next",
      "dev",
      "apps/web",
      "--hostname",
      "127.0.0.1",
      "--port",
      process.env.NERILO_WEB_PORT ?? "5185",
    ],
    { stdout: "inherit", stderr: "inherit" },
  ),
];
const stop = () => {
  for (const child of children) child.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
const code = await Promise.race(children.map((c) => c.exited));
stop();
process.exit(code);
export {};
