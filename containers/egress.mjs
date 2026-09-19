import http from "node:http";
import net from "node:net";
import { lookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";

const hosts = {
  codex: ["api.openai.com", "auth.openai.com", "chatgpt.com"],
  claude: [
    "api.anthropic.com",
    "platform.claude.com",
    "claude.ai",
    "claude.com",
  ],
};
export function publicIPv4(address) {
  if (net.isIP(address) !== 4) return false;
  const [a, b, c] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113)
  );
}
export function allowedTarget(authority, provider, gatewayUrl) {
  if (gatewayUrl) {
    const url = new URL(gatewayUrl);
    return url.protocol === "https:" &&
      authority.toLowerCase() === `${url.hostname}:${url.port || "443"}`
      ? url.hostname
      : null;
  }
  const match = /^([a-z0-9.-]+):443$/i.exec(authority);
  return match && hosts[provider]?.includes(match[1].toLowerCase())
    ? match[1].toLowerCase()
    : null;
}
export function gatewayIPv4(address) {
  if (publicIPv4(address)) return true;
  if (net.isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number);
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}
// Require the TLS ClientHello to name the same host as CONNECT.
export function serverName(record) {
  if (record.length < 5) return undefined;
  if (record[0] !== 22 || record[1] !== 3) return null;
  const end = 5 + record.readUInt16BE(3);
  if (record.length < end) return undefined;
  try {
    if (record[5] !== 1) return null;
    let offset = 43;
    offset += 1 + record[offset];
    offset += 2 + record.readUInt16BE(offset);
    offset += 1 + record[offset];
    const extensionsEnd = offset + 2 + record.readUInt16BE(offset);
    offset += 2;
    if (extensionsEnd > end) return null;
    while (offset + 4 <= extensionsEnd) {
      const type = record.readUInt16BE(offset);
      const size = record.readUInt16BE(offset + 2);
      offset += 4;
      if (offset + size > extensionsEnd) return null;
      if (type === 0) {
        if (record[offset + 2] !== 0) return null;
        const length = record.readUInt16BE(offset + 3);
        if (length + 5 !== size) return null;
        return record
          .subarray(offset + 5, offset + 5 + length)
          .toString("ascii")
          .toLowerCase();
      }
      offset += size;
    }
  } catch {
    return null;
  }
  return null;
}

export function startProxy(provider, port = 8080, gatewayUrl) {
  if (!hosts[provider]) throw new Error("Unknown provider.");
  const server = http.createServer({ maxHeaderSize: 8192 }, (_req, res) => {
    res.writeHead(403);
    res.end("CONNECT only");
  });
  server.maxConnections = 128;
  server.on("connect", async (request, client, head) => {
    client.on("error", () => {});
    const host = allowedTarget(request.url, provider, gatewayUrl);
    if (!host) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    let addresses;
    try {
      addresses = await lookup(host, { family: 4, all: true });
    } catch {
      client.destroy();
      return;
    }
    if (
      !addresses.length ||
      addresses.some(
        (entry) =>
          !(gatewayUrl
            ? gatewayIPv4(entry.address)
            : publicIPv4(entry.address)),
      )
    ) {
      client.destroy();
      return;
    }
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    client.setTimeout(10000, () => client.destroy());
    let pending = head;
    const receive = (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      if (pending.length > 65536) {
        client.destroy();
        return;
      }
      const name = serverName(pending);
      if (name === undefined) return;
      client.removeListener("data", receive);
      if (name !== host) {
        client.destroy();
        return;
      }
      client.pause();
      const upstream = net.connect({
        host: addresses[0].address,
        port: gatewayUrl ? Number(new URL(gatewayUrl).port || 443) : 443,
      });
      upstream.setTimeout(300000, () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
      upstream.once("connect", () => {
        client.setTimeout(300000);
        upstream.write(pending);
        upstream.pipe(client);
        client.pipe(upstream);
        client.resume();
      });
    };
    client.on("data", receive);
    if (pending.length) receive(Buffer.alloc(0));
  });
  server.listen(port, "0.0.0.0", () =>
    process.stdout.write("Provider egress ready\n"),
  );
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  startProxy(process.env.NERILO_PROVIDER, 8080, process.env.NERILO_GATEWAY_URL);
