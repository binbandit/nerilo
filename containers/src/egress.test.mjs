import { test, expect } from "bun:test";
import {
  publicIPv4,
  gatewayIPv4,
  allowedTarget,
  serverName,
} from "./egress.mjs";
test("provider egress rejects private addresses, authority tricks and unknown targets", () => {
  for (const ip of [
    "127.0.0.1",
    "10.1.2.3",
    "192.168.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "198.18.0.1",
  ])
    expect(publicIPv4(ip)).toBe(false);
  expect(publicIPv4("1.1.1.1")).toBe(true);
  expect(allowedTarget("api.openai.com:443", "codex")).toBe("api.openai.com");
  for (const authority of [
    "127.0.0.1:443",
    "api.openai.com:444",
    "api.openai.com.evil.test:443",
    "user@api.openai.com:443",
    "api.anthropic.com:443",
  ])
    expect(allowedTarget(authority, "codex")).toBeNull();
  expect(serverName(Buffer.from("GET / HTTP/1.1\r\n"))).toBeNull();
});
test("a gateway connection permits only the configured TLS authority, including private company networks", () => {
  const url = "https://gateway.company.test:8443/v1";
  expect(allowedTarget("gateway.company.test:8443", "codex", url)).toBe(
    "gateway.company.test",
  );
  for (const authority of [
    "api.openai.com:443",
    "api.anthropic.com:443",
    "gateway.company.test:443",
    "gateway.company.test.evil.test:8443",
    "10.0.0.1:8443",
  ])
    expect(allowedTarget(authority, "codex", url)).toBeNull();
  for (const address of ["10.1.2.3", "172.20.0.1", "192.168.1.1", "100.64.1.1"])
    expect(gatewayIPv4(address)).toBe(true);
  for (const address of [
    "127.0.0.1",
    "169.254.169.254",
    "0.0.0.0",
    "224.0.0.1",
  ])
    expect(gatewayIPv4(address)).toBe(false);
});
