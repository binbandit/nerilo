import { expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMachineIdentity } from "./machine-identity";

test("machine identity survives restarts and renames with private storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-machine-"));
  try {
    const original = readMachineIdentity(directory, "Build Mac");
    expect(readMachineIdentity(directory, "Office Mac")).toEqual({
      ...original,
      name: "Office Mac",
    });
    expect(original).toMatchObject({
      name: "Build Mac",
      platform: process.platform,
      protocolVersion: 1,
    });
    expect(readFileSync(join(directory, "machine-id"), "utf8").trim()).toBe(
      original.id,
    );
    expect(statSync(join(directory, "machine-id")).mode & 0o777).toBe(0o600);
    expect(readdirSync(directory)).toEqual(["machine-id"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent initializers agree on one complete persistent identity", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-machine-race-"));
  try {
    const source = `import {readMachineIdentity} from ${JSON.stringify(join(import.meta.dirname, "machine-identity.ts"))}; console.log(readMachineIdentity(process.argv[1]).id)`;
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const child = Bun.spawn([process.execPath, "-e", source, directory], {
          stdout: "pipe",
          stderr: "pipe",
        });
        const [output, error, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(error).toBe("");
        expect(code).toBe(0);
        return output.trim();
      }),
    );
    expect(new Set(results).size).toBe(1);
    expect(readMachineIdentity(directory).id).toBe(results[0]);
    expect(readdirSync(directory)).toEqual(["machine-id"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid and linked identity files are rejected without replacing them", () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-machine-invalid-"));
  try {
    const path = join(directory, "machine-id");
    writeFileSync(path, "invalid");
    expect(() => readMachineIdentity(directory)).toThrow(
      "stored machine identity is invalid",
    );
    expect(readFileSync(path, "utf8")).toBe("invalid");
    rmSync(path);
    const target = join(directory, "elsewhere");
    writeFileSync(target, crypto.randomUUID());
    symlinkSync(target, path);
    expect(() => readMachineIdentity(directory)).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("connection export keeps the token private and never overwrites an existing file", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nerilo-machine-export-"));
  try {
    const output = join(directory, "connection.json");
    const script = join(
      import.meta.dirname,
      "../../../scripts/machine-connection.ts",
    );
    const run = async (url: string) => {
      const child = Bun.spawn(
        [process.execPath, script, "--output", output, "--url", url],
        {
          env: { ...process.env, NERILO_DATA_DIR: join(directory, "data") },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      return { stdout, stderr, code };
    };
    expect(await run("http://127.0.0.1:5187")).toEqual({
      stdout: `${output}\n`,
      stderr: "",
      code: 0,
    });
    const contents = readFileSync(output, "utf8");
    const exported: { url: string; token: string; machineId: string } =
      JSON.parse(contents);
    expect(exported.url).toBe("http://127.0.0.1:5187");
    expect(exported.machineId).toBe(
      readMachineIdentity(join(directory, "data")).id,
    );
    expect(exported.token.length).toBeGreaterThan(30);
    expect(statSync(output).mode & 0o777).toBe(0o600);
    const duplicate = await run("https://machine.example.test");
    expect(duplicate.code).toBe(1);
    expect(duplicate.stdout).toBe("");
    expect(duplicate.stderr.includes(exported.token)).toBe(false);
    expect(readFileSync(output, "utf8")).toBe(contents);
    for (const url of [
      "http://192.168.1.10:5186",
      "https://token@host.test",
      "https://host.test/path",
    ]) {
      const invalid = await run(url);
      expect(invalid.code).toBe(1);
      expect(invalid.stderr).toContain("HTTPS daemon URL");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
