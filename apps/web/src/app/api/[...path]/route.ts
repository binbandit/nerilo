import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MachineError, MachineRegistry } from "@/lib/machine-registry";

import {
  readRequestText,
  RequestTooLargeError,
  SKILLS_REQUEST_LIMIT,
} from "@nerilo/protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function handler(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const url = new URL(request.url);
  const selectedMachine = url.searchParams.get("machine");
  const expectedPort = process.env.NERILO_WEB_PORT ?? "5185";
  const allowedHosts = [
    `127.0.0.1:${expectedPort}`,
    `localhost:${expectedPort}`,
  ];
  if (
    !allowedHosts.includes(request.headers.get("host") ?? "") ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    return Response.json(
      { error: "This request is not from Nerilo." },
      { status: 403 },
    );
  const origin = request.headers.get("origin");
  if (origin && origin !== `http://${request.headers.get("host")}`)
    return Response.json({ error: "Origin rejected." }, { status: 403 });
  if (request.method === "POST" && !origin)
    return Response.json({ error: "Origin is required." }, { status: 403 });
  const { path } = await params;
  let sessionCookie: string | undefined;
  try {
    const token = (
      await readFile(
        join(
          process.env.NERILO_DATA_DIR ?? join(homedir(), ".nerilo"),
          "daemon-token",
        ),
        "utf8",
      )
    ).trim();
    const session = createHmac("sha256", token)
      .update("nerilo-browser-session")
      .digest("hex");
    const cookieName = `nerilo-session-${expectedPort}`;
    const cookie =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1) ?? "";
    const bootstrap =
      path.join("/") === "bootstrap" && request.method === "GET";
    if (!bootstrap && !equal(cookie, session))
      return Response.json(
        { error: "Reconnect to Nerilo to continue." },
        { status: 401 },
      );
    if (bootstrap)
      sessionCookie = `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`;
    const registry = new MachineRegistry(
      process.env.NERILO_DATA_DIR ?? join(homedir(), ".nerilo"),
      {
        url: `http://127.0.0.1:${process.env.NERILO_DAEMON_PORT ?? 5186}`,
        token,
      },
    );
    const raw =
      request.method === "POST"
        ? await readRequestText(
            request,
            path.join("/") === "skills" ? SKILLS_REQUEST_LIMIT : 100000,
          )
        : undefined;
    if (path[0] === "machines") {
      const responseHeaders = { "Cache-Control": "no-store" };
      if (request.method === "GET" && path.length === 1)
        return Response.json(await registry.list(), {
          headers: responseHeaders,
        });
      if (request.method === "POST" && path.length <= 2) {
        const body: unknown = JSON.parse(raw || "{}");
        const result =
          path.length === 1
            ? await registry.register(body)
            : await registry.update(path[1], body);
        return Response.json(result, { headers: responseHeaders });
      }
      return Response.json(
        { error: "Machine route not found." },
        { status: 404 },
      );
    }
    const target = await registry.resolve(selectedMachine);
    url.searchParams.delete("machine");
    const headers: Record<string, string> = {
      Authorization: `Bearer ${target.token}`,
    };
    if (request.headers.get("idempotency-key"))
      headers["Idempotency-Key"] = request.headers.get("idempotency-key")!;
    if (request.method === "POST") headers["Content-Type"] = "application/json";
    const connection = new AbortController();
    const connectionTimeout =
      path.join("/") === "events"
        ? setTimeout(() => connection.abort(), 15_000)
        : undefined;
    let response: Response;
    try {
      response = await fetch(
        `${target.url}/${bootstrap ? "snapshot" : path.map(encodeURIComponent).join("/")}${url.search}`,
        {
          method: request.method,
          headers,
          body: raw,
          cache: "no-store",
          redirect: "error",
          signal:
            path.join("/") === "events"
              ? AbortSignal.any([request.signal, connection.signal])
              : AbortSignal.any([
                  request.signal,
                  connection.signal,
                  AbortSignal.timeout(120_000),
                ]),
        },
      );
    } finally {
      if (connectionTimeout) clearTimeout(connectionTimeout);
    }
    const outgoing = new Headers({
      "Content-Type":
        response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (sessionCookie) outgoing.set("Set-Cookie", sessionCookie);
    if (response.headers.get("content-disposition"))
      outgoing.set(
        "Content-Disposition",
        response.headers.get("content-disposition")!,
      );
    return new Response(response.body, {
      status: response.status,
      headers: outgoing,
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof MachineError || error instanceof RequestTooLargeError
            ? error.message
            : error instanceof SyntaxError
              ? "Check the machine name, URL, and connection token."
              : selectedMachine && selectedMachine !== "local"
                ? "Cannot reach this machine. Check its daemon and connection, then retry."
                : "Nerilo cannot reach its local daemon. Start it with bun run daemon, then reconnect.",
      },
      {
        status:
          error instanceof RequestTooLargeError
            ? 413
            : error instanceof MachineError
              ? error.status
              : error instanceof SyntaxError
                ? 400
                : 503,
        headers: sessionCookie
          ? { "Set-Cookie": sessionCookie, "Cache-Control": "no-store" }
          : { "Cache-Control": "no-store" },
      },
    );
  }
}
export const GET = handler;
export const POST = handler;
