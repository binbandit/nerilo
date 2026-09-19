/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import {
  activityPresentation,
  readableCommand,
  terminalText,
} from "./activity-format";

describe("activity presentation", () => {
  test("unwraps one shell argument without changing escaped search patterns", () => {
    expect(
      readableCommand('/bin/bash -lc "rg -n \\"close\\\\(\\\\)\\" file.ts"'),
    ).toBe('rg -n "close\\(\\)" file.ts');
    expect(readableCommand("/bin/bash -lc 'bun run test'")).toBe(
      "bun run test",
    );
    const compound = "/bin/bash -lc 'echo hello' && echo 'world'";
    expect(readableCommand(compound)).toBe(compound);
    const unknown = '/bin/bash -lc "echo one" "two"';
    expect(readableCommand(unknown)).toBe(unknown);
  });

  test("separates command from output and preserves unknown records", () => {
    const event = activityPresentation(
      "/bin/bash -lc 'bun run test'\n15 pass\n0 fail",
    );
    expect(event.command).toBe("bun run test");
    expect(event.output).toBe("15 pass\n0 fail");
    const unknown = '{"type":"future_tool","payload":"retained"}';
    expect(activityPresentation(unknown).output).toBe(unknown);
    expect(
      activityPresentation(
        'Bash {"command":"pwd","description":"Read workspace path"}',
      ).detail,
    ).toBe("Read workspace path");
  });

  test("decodes adjacent quote segments used by the recorded Codex command", () => {
    const command = String.raw`/bin/bash -lc "rg -n \"repository\" . --glob '"'!bun.lock'"' --glob '"'!*.map'"'"`;
    expect(readableCommand(command)).toBe(
      `rg -n "repository" . --glob '!bun.lock' --glob '!*.map'`,
    );
    expect(activityPresentation(`${command}\nmatching line`).output).toBe(
      "matching line",
    );
    for (const value of [
      "/bin/bash -lc 'echo'$(pwd)",
      "/bin/bash -lc 'echo'*",
      "/bin/bash -lc 'unterminated",
    ]) {
      expect(readableCommand(value)).toBe(value);
    }
  });

  test("keeps multiline shell scripts separate from their output", () => {
    const script =
      "set +e\nnode --test greeting.test.cjs\nstatus=$?\nexit $status";
    const event = activityPresentation(
      `/bin/bash -lc '${script}'\n6 tests passed\n`,
    );
    expect(event.kind).toBe("command");
    expect(event.command).toBe(script);
    expect(event.output).toBe("6 tests passed\n");
    expect(activityPresentation(`/bin/bash -lc '${script}'`).output).toBe("");
    const incomplete = "/bin/bash -lc 'set +e\nunterminated";
    expect(activityPresentation(incomplete).output).toBe(incomplete);
    const compound = "/bin/bash -lc 'echo ok' && echo unsafe\noutput";
    expect(activityPresentation(compound).kind).toBe("text");
  });

  test("distinguishes a plain notice from output worth opening", () => {
    expect(activityPresentation("Preparing the isolated workspace").kind).toBe(
      "notice",
    );
    expect(
      activityPresentation("Preparing project\nResolved dependencies").kind,
    ).toBe("text");
    expect(activityPresentation('{"type":"future_tool"}').kind).toBe("text");
  });

  test("removes terminal controls while preserving text and literal markup", () => {
    expect(
      terminalText(
        "\x1b[32m15 pass\x1b[0m\r\n\x1b]8;;https://example.com\x07link\x1b]8;;\x07\n<script>literal</script>",
      ),
    ).toBe("15 pass\nlink\n<script>literal</script>");
  });
});
