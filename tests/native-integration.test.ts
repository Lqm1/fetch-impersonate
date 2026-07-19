import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";

import axios, { type AxiosRequestConfig } from "axios";
import ky from "ky";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createFetch, fetch } from "../src/index.js";

const nativePath = resolve(
  `crates/native/fetch-impersonate.${currentNativeTarget()}.node`,
);
const describeNative = existsSync(nativePath) ? describe : describe.skip;

describeNative("native integration", () => {
  let server: Server;
  let proxyServer: Server;
  let origin: string;
  let proxyOrigin: string;
  let proxyRequests = 0;
  let largeBytesSent = 0;
  let cancelledRequestClosed = false;

  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url?.startsWith("/redirect/")) {
        const status = Number(request.url.slice("/redirect/".length));
        response.writeHead(status, { location: "/redirect-final" });
        response.end();
        return;
      }

      switch (request.url) {
        case "/status/404":
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("missing");
          break;
        case "/echo": {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({
              body: Buffer.concat(chunks).toString("utf8"),
              headers: request.headers,
              method: request.method,
            }));
          });
          break;
        }
        case "/redirect-final": {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            response.setHeader("content-type", "application/json");
            response.end(JSON.stringify({
              body: Buffer.concat(chunks).toString("utf8"),
              method: request.method,
            }));
          });
          break;
        }
        case "/cookies":
          response.setHeader("set-cookie", ["one=1; Path=/", "two=2; Path=/"]);
          response.end(request.headers.cookie ?? "none");
          break;
        case "/http-version":
          response.end(request.httpVersion);
          break;
        case "/slow": {
          response.writeHead(200, { "content-type": "text/plain" });
          response.flushHeaders();
          const timer = setTimeout(() => response.end("late"), 5_000);
          request.on("close", () => clearTimeout(timer));
          break;
        }
        case "/stream": {
          response.writeHead(200, { "content-type": "text/plain" });
          response.flushHeaders();
          response.write("first");
          const timer = setTimeout(() => response.end("second"), 150);
          request.on("close", () => clearTimeout(timer));
          break;
        }
        case "/partial": {
          response.writeHead(200, {
            "content-length": "100",
            "content-type": "text/plain",
          });
          response.flushHeaders();
          response.write("short");
          const timer = setTimeout(() => response.destroy(), 30);
          request.on("close", () => clearTimeout(timer));
          break;
        }
        case "/large": {
          const total = 16 * 1024 * 1024;
          const chunk = Buffer.alloc(64 * 1024, 97);
          largeBytesSent = 0;
          response.writeHead(200, { "content-length": String(total) });
          const send = (): void => {
            while (largeBytesSent < total) {
              largeBytesSent += chunk.length;
              if (!response.write(chunk)) {
                response.once("drain", send);
                return;
              }
            }
            response.end();
          };
          send();
          break;
        }
        case "/cancel": {
          cancelledRequestClosed = false;
          response.writeHead(200, { "content-type": "application/octet-stream" });
          response.flushHeaders();
          const timer = setInterval(() => response.write(Buffer.alloc(16 * 1024)), 5);
          request.on("close", () => {
            cancelledRequestClosed = true;
            clearInterval(timer);
          });
          break;
        }
        default:
          response.end("ok");
      }
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, "127.0.0.1", resolveListen);
    });
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("test server has no TCP address");
    }
    origin = `http://127.0.0.1:${address.port}`;

    proxyServer = createServer((_request, response) => {
      proxyRequests += 1;
      response.setHeader("x-fetch-impersonate-proxy", "yes");
      response.end("through-proxy");
    });
    await new Promise<void>((resolveListen) => {
      proxyServer.listen(0, "127.0.0.1", resolveListen);
    });
    const proxyAddress = proxyServer.address();
    if (proxyAddress === null || typeof proxyAddress === "string") {
      throw new Error("proxy test server has no TCP address");
    }
    proxyOrigin = `http://127.0.0.1:${proxyAddress.port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    proxyServer.closeAllConnections();
    await Promise.all([closeServer(server), closeServer(proxyServer)]);
  });

  it("returns a Response instead of rejecting HTTP 404", async () => {
    const response = await fetch(`${origin}/status/404`);
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("missing");
  });

  it("sends buffered request bodies and user headers", async () => {
    const response = await fetch(`${origin}/echo`, {
      method: "POST",
      headers: { "x-request": "yes" },
      body: "payload",
    });
    await expect(response.json()).resolves.toMatchObject({
      body: "payload",
      headers: { "x-request": "yes" },
      method: "POST",
    });
  });

  it("accepts URL and Request inputs", async () => {
    const urlResponse = await fetch(new URL("/echo", origin), {
      headers: { "x-input": "url" },
    });
    await expect(urlResponse.json()).resolves.toMatchObject({
      headers: { "x-input": "url" },
      method: "GET",
    });

    const request = new Request(`${origin}/echo`, {
      method: "POST",
      headers: { "x-input": "request" },
      body: "from-request",
    });
    const requestResponse = await fetch(request);
    await expect(requestResponse.json()).resolves.toMatchObject({
      body: "from-request",
      headers: { "x-input": "request" },
      method: "POST",
    });
  });

  it("serializes URLSearchParams, Blob, ArrayBuffer, and FormData bodies", async () => {
    const cases: Array<{
      body: BodyInit;
      contentType?: string;
      expectedBody: string;
    }> = [
      {
        body: new URLSearchParams({ alpha: "one", beta: "two words" }),
        contentType: "application/x-www-form-urlencoded;charset=UTF-8",
        expectedBody: "alpha=one&beta=two+words",
      },
      {
        body: new Blob(["blob-value"], { type: "text/custom" }),
        contentType: "text/custom",
        expectedBody: "blob-value",
      },
      {
        body: new TextEncoder().encode("buffer-value").buffer,
        expectedBody: "buffer-value",
      },
    ];

    for (const testCase of cases) {
      const response = await fetch(`${origin}/echo`, {
        method: "POST",
        body: testCase.body,
      });
      const payload = await response.json() as {
        body: string;
        headers: Record<string, string>;
      };
      expect(payload.body).toBe(testCase.expectedBody);
      if (testCase.contentType !== undefined) {
        expect(payload.headers["content-type"]).toBe(testCase.contentType);
      }
    }

    const form = new FormData();
    form.set("field", "form-value");
    form.set("file", new Blob(["file-value"], { type: "text/plain" }), "sample.txt");
    const response = await fetch(`${origin}/echo`, { method: "POST", body: form });
    const payload = await response.json() as {
      body: string;
      headers: Record<string, string>;
    };
    const contentType = payload.headers["content-type"];
    expect(contentType).toMatch(/^multipart\/form-data; boundary=/);
    const boundary = contentType!.slice(contentType!.indexOf("boundary=") + 9);
    expect(payload.body).toContain(`--${boundary}`);
    expect(payload.body).toContain('name="field"');
    expect(payload.body).toContain("form-value");
    expect(payload.body).toContain('filename="sample.txt"');
    expect(payload.body).toContain("file-value");
  });

  it("implements follow, manual, and error redirect modes", async () => {
    const followed = await fetch(`${origin}/redirect/302`);
    expect(followed.status).toBe(200);
    expect(followed.redirected).toBe(true);
    expect(followed.url).toBe(`${origin}/redirect-final`);
    await expect(followed.json()).resolves.toMatchObject({ method: "GET" });

    const manual = await fetch(`${origin}/redirect/302`, { redirect: "manual" });
    expect(manual.status).toBe(302);
    expect(manual.redirected).toBe(false);
    expect(manual.url).toBe(`${origin}/redirect/302`);
    expect(manual.headers.get("location")).toBe("/redirect-final");

    const error = await fetch(`${origin}/redirect/302`, {
      redirect: "error",
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("fetch failed");
    expect((error as Error & { cause: unknown }).cause).toMatchObject({
      code: "FETCH_REDIRECT_ERROR",
    });
  });

  it("uses Fetch redirect method and body rules", async () => {
    const converted = await fetch(`${origin}/redirect/302`, {
      method: "POST",
      body: "convert-me",
    });
    await expect(converted.json()).resolves.toEqual({ body: "", method: "GET" });

    const preserved = await fetch(`${origin}/redirect/307`, {
      method: "POST",
      body: "preserve-me",
    });
    await expect(preserved.json()).resolves.toEqual({
      body: "preserve-me",
      method: "POST",
    });
  });

  it("supports Response.clone and standard bodyUsed behavior", async () => {
    const response = await fetch(`${origin}/stream`);
    const clone = response.clone();
    expect(response.bodyUsed).toBe(false);
    const originalText = response.text();
    expect(response.bodyUsed).toBe(true);
    await expect(Promise.all([originalText, clone.text()])).resolves.toEqual([
      "firstsecond",
      "firstsecond",
    ]);
    expect(clone.bodyUsed).toBe(true);
    expect(() => response.clone()).toThrow(TypeError);
  });

  it("preserves AbortSignal.reason before headers and during a body", async () => {
    const preAborted = new AbortController();
    const preReason = { phase: "before" };
    preAborted.abort(preReason);
    await expect(fetch(`${origin}/`, { signal: preAborted.signal })).rejects.toBe(preReason);

    const during = new AbortController();
    const response = await fetch(`${origin}/slow`, { signal: during.signal });
    const bodyReason = { phase: "body" };
    during.abort(bodyReason);
    await expect(response.text()).rejects.toBe(bodyReason);
  });

  it("applies browser default headers through impersonation", async () => {
    const response = await fetch(`${origin}/echo`, {
      impersonate: "chrome",
      defaultHeaders: true,
    });
    const payload = await response.json() as { headers: Record<string, string> };
    expect(payload.headers["user-agent"]).toContain("Chrome/");
  });

  it("integrates with ky through createFetch", async () => {
    const api = ky.create({
      fetch: createFetch({ impersonate: "chrome", defaultHeaders: true }),
    });
    const payload = await api.get(`${origin}/echo`).json<{
      headers: Record<string, string>;
      method: string;
    }>();
    expect(payload.method).toBe("GET");
    expect(payload.headers["user-agent"]).toContain("Chrome/");
  });

  it("integrates with the Axios fetch adapter through createFetch", async () => {
    const api = axios.create({
      adapter: "fetch",
      env: {
        fetch: createFetch({ impersonate: "chrome", defaultHeaders: true }),
        Request: globalThis.Request,
        Response: globalThis.Response,
      } as NonNullable<AxiosRequestConfig["env"]>,
    });
    const response = await api.get<{
      headers: Record<string, string>;
      method: string;
    }>(`${origin}/echo`);
    expect(response.data.method).toBe("GET");
    expect(response.data.headers["user-agent"]).toBe("axios/1.18.1");
    expect(response.data.headers["sec-ch-ua"]).toContain("Chromium");
  });

  it("routes requests through an explicit HTTP proxy", async () => {
    const previousRequests = proxyRequests;
    const response = await fetch("http://fetch-impersonate.invalid/resource", {
      proxy: proxyOrigin,
    });
    expect(await response.text()).toBe("through-proxy");
    expect(response.headers.get("x-fetch-impersonate-proxy")).toBe("yes");
    expect(proxyRequests).toBe(previousRequests + 1);
  });

  it("enforces total timeouts and selects HTTP/1.1", async () => {
    const timeoutResponse = await fetch(`${origin}/slow`, { timeout: 30 });
    const timeoutError = await timeoutResponse.text().catch((reason: unknown) => reason);
    expect(timeoutError).toBeInstanceOf(TypeError);
    expect((timeoutError as Error & { cause: unknown }).cause).toMatchObject({
      code: "CURLE_OPERATION_TIMEDOUT",
    });

    const response = await fetch(`${origin}/http-version`, {
      httpVersion: "1.1",
    });
    await expect(response.text()).resolves.toBe("1.1");
  });

  it("applies curl_cffi-compatible JA3, Akamai, and extra fingerprint options", async () => {
    const ja3 = [
      "771",
      "4865-4866-4867-49195-49196-52393-49199-49200-52392-49171-49172-156-157-47-53",
      "0-23-65281-10-11-35-16-5-13-51-45-43-21",
      "29-23-24",
      "0",
    ].join(",");
    const response = await fetch(`${origin}/`, {
      ja3,
      akamai: "4:16777216|16711681|0|m,p,a,s",
      extraFp: {
        tlsMinVersion: "1.2",
        tlsGrease: false,
        tlsPermuteExtensions: false,
        tlsCertCompression: "brotli",
        tlsSignatureAlgorithms: [
          "ecdsa_secp256r1_sha256",
          "rsa_pss_rsae_sha256",
        ],
        http2StreamWeight: 256,
        http2StreamExclusive: true,
      },
    });
    await expect(response.text()).resolves.toBe("ok");
  });

  it("rejects malformed custom fingerprint options as TypeError", async () => {
    await expect(fetch(`${origin}/`, { ja3: "not-ja3" })).rejects.toThrow(
      "ja3 must contain exactly five",
    );
    await expect(fetch(`${origin}/`, { akamai: "not-akamai" })).rejects.toThrow(
      "akamai must contain exactly four",
    );
    await expect(fetch(`${origin}/`, {
      extraFp: { http2StreamWeight: 0 },
    })).rejects.toThrow("http2StreamWeight must be between 1 and 256");
  });

  it("does not retain cookies between transfers", async () => {
    const first = await fetch(`${origin}/cookies`);
    expect(first.headers.getSetCookie()).toHaveLength(2);
    await first.text();
    const second = await fetch(`${origin}/cookies`);
    await expect(second.text()).resolves.toBe("none");
  });

  it("sends an explicit Cookie header", async () => {
    const response = await fetch(`${origin}/cookies`, {
      headers: { cookie: "manual=yes" },
    });
    await expect(response.text()).resolves.toBe("manual=yes");
  });

  it("cancels a transfer after response headers", async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/slow`, { signal: controller.signal });
    const reason = new Error("cancel native body");
    controller.abort(reason);
    await expect(response.text()).rejects.toBe(reason);
  });

  it("maps connection failures to fetch failed", async () => {
    const error = await fetch("http://127.0.0.1:1", {
      connectTimeout: 500,
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("fetch failed");
  });

  it("resolves at headers and supplies body chunks incrementally", async () => {
    const startedAt = performance.now();
    const response = await fetch(`${origin}/stream`);
    expect(performance.now() - startedAt).toBeLessThan(140);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    const first = await reader!.read();
    expect(new TextDecoder().decode(first.value)).toBe("first");
    const second = await reader!.read();
    expect(new TextDecoder().decode(second.value)).toBe("second");
    expect((await reader!.read()).done).toBe(true);
  });

  it("applies native backpressure until JavaScript reads the body", async () => {
    const response = await fetch(`${origin}/large`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 200));
    expect(largeBytesSent).toBeLessThan(16 * 1024 * 1024);
    const body = await response.arrayBuffer();
    expect(body.byteLength).toBe(16 * 1024 * 1024);
  }, 15_000);

  it("errors the Response body when the connection fails mid-stream", async () => {
    const response = await fetch(`${origin}/partial`);
    const error = await response.text().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("fetch failed");
    expect((error as Error & { cause: unknown }).cause).toMatchObject({
      code: "CURLE_PARTIAL_FILE",
    });
  });

  it("cancels native transfer when the Response body is cancelled", async () => {
    const response = await fetch(`${origin}/cancel`);
    await response.body?.cancel("not needed");
    for (let attempt = 0; attempt < 50 && !cancelledRequestClosed; attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
    expect(cancelledRequestClosed).toBe(true);
  });
});

function currentNativeTarget(): string {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "linux") {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    const libc = report?.header?.glibcVersionRuntime === undefined ? "musl" : "gnu";
    return `linux-${process.arch}-${libc}`;
  }
  return `${process.platform}-${process.arch}`;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => error === undefined ? resolveClose() : rejectClose(error));
  });
}
