import { expect, test } from "bun:test";
import { codexDevicePrompt } from "./codex-login";

test("Codex sign-in recognizes the official device prompt and rejects lookalike links", () => {
  expect(
    codexDevicePrompt(
      "\x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n   \x1b[94mABCD-EFGHI\x1b[0m\n",
    ),
  ).toEqual({
    url: "https://auth.openai.com/codex/device",
    deviceCode: "ABCD-EFGHI",
  });
  for (const url of [
    "https://auth.openai.com.evil.test/codex/device",
    "https://auth.openai.com/codex/device?redirect=evil",
    "http://auth.openai.com/codex/device",
  ])
    expect(codexDevicePrompt(`${url}\nABCD-EFGHI\n`)).toBeNull();
  expect(
    codexDevicePrompt("https://auth.openai.com/codex/device\n"),
  ).toBeNull();
});
