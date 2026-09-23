import { expect, test } from "bun:test";
import { codexDevicePrompt, handleCodexLogin } from "./codex-login";

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

test("invalid Codex sign-in requests leave the sign-in state unchanged", async () => {
  const url = "http://127.0.0.1/connections/codex/login";
  const post = (body: string) =>
    handleCodexLogin(new Request(url, { method: "POST", body }), () => {});
  const before = await (await handleCodexLogin(
    new Request(url),
    () => {},
  ))!.json();
  expect((await post("not json"))!.status).toBe(400);
  expect((await post("x".repeat(2000)))!.status).toBe(413);
  const after = await (await handleCodexLogin(
    new Request(url),
    () => {},
  ))!.json();
  expect(after).toEqual(before);
});
