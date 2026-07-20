import type { NativeHeadersEvent } from "./native-types.js";

export function createResponse(
  event: NativeHeadersEvent,
  body: ReadableStream<Uint8Array> | null,
): Response {
  const response = new Response(body, {
    status: event.status,
    statusText: event.statusText,
    headers: event.headers,
  });

  Object.defineProperties(response, {
    redirected: {
      configurable: true,
      enumerable: true,
      value: event.redirected,
    },
    url: {
      configurable: true,
      enumerable: true,
      value: event.url,
    },
  });

  return response;
}

export function responseMustNotHaveBody(requestMethod: string, status: number): boolean {
  return (
    requestMethod === "HEAD" || status === 101 || status === 204 || status === 205 || status === 304
  );
}
