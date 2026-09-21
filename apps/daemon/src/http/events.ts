import type { Store } from "../platform/store";

export function eventStream(request: Request, url: URL, store: Store) {
  let cursor = Number(url.searchParams.get("after") ?? 0);
  let timer: ReturnType<typeof setInterval> | undefined;
  let close = () => {};
  const stream = new ReadableStream({
    start(controller) {
      if (request.signal.aborted) {
        controller.close();
        return;
      }
      const send = () => {
        if ((controller.desiredSize ?? 0) <= 0) return;
        const next = store.sequence();
        controller.enqueue(
          new TextEncoder().encode(
            next !== cursor
              ? `id: ${next}\nevent: change\ndata: ${next}\n\n`
              : ": heartbeat\n\n",
          ),
        );
        cursor = next;
      };
      send();
      timer = setInterval(send, 1500);
      close = () => {
        clearInterval(timer);
        request.signal.removeEventListener("abort", close);
        try {
          controller.close();
        } catch {}
      };
      request.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      clearInterval(timer);
      request.signal.removeEventListener("abort", close);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
