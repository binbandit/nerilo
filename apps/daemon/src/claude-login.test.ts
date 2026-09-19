import { test, expect } from "bun:test";
import {
  claudeAuthorizationURL,
  parseClaudeLoginStatus,
  handleClaudeLogin,
} from "./claude-login";

test("native sign-in only exposes the official authorization URL", () => {
  expect(
    claudeAuthorizationURL(
      "https://claude.com/cai/oauth/authorize?code_challenge=fixture&state=test",
    ),
  ).toBe(
    "https://claude.com/cai/oauth/authorize?code_challenge=fixture&state=test",
  );
  expect(
    claudeAuthorizationURL(
      "Open https://claude.ai/oauth/authorize?code_challenge=fixture&state=test to continue",
    ),
  ).toBe("https://claude.ai/oauth/authorize?code_challenge=fixture&state=test");
  for (const value of [
    "https://claude.ai.evil.example/oauth/authorize",
    "https://claude.ai@evil.example/oauth/authorize",
    "https://evil.example@claude.ai/oauth/authorize",
    "https://claude.ai/oauth/token?access_token=secret",
    "http://claude.ai/oauth/authorize",
    "https://example.com/oauth/authorize",
    "https://claude.com/oauth/authorize",
    "https://claude.com/cai/oauth/token",
    "https://claude.com.evil.example/cai/oauth/authorize",
  ])
    expect(claudeAuthorizationURL(value)).toBeNull();
});

test("native auth status exposes a boolean, never account information or credentials", () => {
  expect(
    parseClaudeLoginStatus(
      JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        email: "private@example.com",
        accessToken: "secret",
      }),
    ),
  ).toBe(true);
  expect(
    parseClaudeLoginStatus('{"loggedIn":true,"authMethod":"api_key"}'),
  ).toBe(false);
  expect(
    parseClaudeLoginStatus('{"loggedIn":false,"authMethod":"claude.ai"}'),
  ).toBe(false);
  expect(parseClaudeLoginStatus("not json")).toBe(false);
  expect(parseClaudeLoginStatus('{"loggedIn":"true"}')).toBe(false);
});

test("native sign-in rejects codes without an active flow and unrelated routes do not consume requests", async () => {
  let selections = 0;
  const select = () => {
    selections++;
  };
  const unrelated = new Request("http://localhost/tasks", {
    method: "POST",
    body: "payload",
  });
  expect(await handleClaudeLogin(unrelated, select)).toBeNull();
  expect(await unrelated.text()).toBe("payload");
  const code = await handleClaudeLogin(
    new Request("http://localhost/connections/claude/login", {
      method: "POST",
      body: JSON.stringify({ action: "code", code: "test-code" }),
    }),
    select,
  );
  expect(code?.status).toBe(400);
  const invalid = await handleClaudeLogin(
    new Request("http://localhost/connections/claude/login", {
      method: "POST",
      body: JSON.stringify({ action: "code", code: "one\nsecond command" }),
    }),
    select,
  );
  expect(invalid?.status).toBe(400);
  expect(selections).toBe(0);
});
