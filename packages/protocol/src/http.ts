export class RequestTooLargeError extends Error {
  constructor() {
    super("Request too large.");
  }
}

export async function readRequestText(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new RequestTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new RequestTooLargeError();
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
