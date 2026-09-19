import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { readMachineIdentity } from "../apps/daemon/src/machine-identity";

async function main() {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      url: { type: "string" },
      output: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });
  if (!values.output)
    throw new Error(
      "Usage: bun scripts/machine-connection.ts --output connection.json [--url https://machine.example.com]",
    );
  const url = new URL(values.url ?? "http://127.0.0.1:5186");
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error(
      "Use an HTTPS daemon URL or an HTTP localhost tunnel URL, with no path, credentials, query, or fragment.",
    );
  const { dataDir, token } = await import("../apps/daemon/src/config");
  const machine = readMachineIdentity(dataDir);
  const output = resolve(values.output);
  writeFileSync(
    output,
    `${JSON.stringify({ url: url.origin, token, machineId: machine.id }, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  console.log(output);
}

try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Could not export machine connection.",
  );
  process.exitCode = 1;
}
