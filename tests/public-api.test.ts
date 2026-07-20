import { afterEach, describe, expect, it } from "vitest";

import defaultFetch, { createFetch, fetch as namedFetch } from "../src/index.js";
import * as publicApi from "../src/index.js";
import { setNativeBindingForTesting } from "../src/native-loader.js";
import { FakeNativeBinding } from "./helpers/fake-native-binding.js";

afterEach(() => {
  setNativeBindingForTesting(undefined);
});

describe("public API", () => {
  it("exports only fetch and createFetch at runtime", () => {
    expect(defaultFetch).toBe(namedFetch);
    expect(Object.keys(publicApi).toSorted()).toEqual(["createFetch", "default", "fetch"]);
  });

  it("returns a standard Response for HTTP error statuses", async () => {
    const native = new FakeNativeBinding(() => ({
      status: 404,
      statusText: "Not Found",
      headers: [["content-type", "text/plain"]],
      body: [new TextEncoder().encode("missing")],
    }));
    setNativeBindingForTesting(native);

    const response = await namedFetch("https://example.com/missing");

    expect(response).toBeInstanceOf(Response);
    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    await expect(response.text()).resolves.toBe("missing");
  });

  it("captures createFetch transport defaults and allows request overrides", async () => {
    const native = new FakeNativeBinding();
    setNativeBindingForTesting(native);
    const defaults = {
      impersonate: "chrome",
      defaultHeaders: true,
      timeout: 1_000,
    } as const;
    const chromeFetch = createFetch(defaults);

    await chromeFetch("https://example.com/one", {
      impersonate: "firefox",
      headers: { "x-test": "one" },
    });

    expect(native.requests[0]?.options).toEqual({
      impersonate: "firefox",
      defaultHeaders: true,
      timeout: 1_000,
    });
    expect(native.requests[0]?.headers).toContainEqual(["x-test", "one"]);
  });

  it("maps curl failures to TypeError with structured cause", async () => {
    const native = new FakeNativeBinding(() => ({
      error: {
        kind: "curlEasy",
        message: "Could not connect",
        code: "CURLE_COULDNT_CONNECT",
        curlCode: 7,
      },
    }));
    setNativeBindingForTesting(native);

    const error = await namedFetch("https://example.invalid").catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe("fetch failed");
    expect((error as Error & { cause: unknown }).cause).toMatchObject({
      code: "CURLE_COULDNT_CONNECT",
      curlCode: 7,
      message: "Could not connect",
    });
  });

  it("rejects with AbortSignal.reason before starting native work", async () => {
    const native = new FakeNativeBinding();
    setNativeBindingForTesting(native);
    const controller = new AbortController();
    const reason = new Error("stop");
    controller.abort(reason);

    await expect(namedFetch("https://example.com", { signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(native.requests).toHaveLength(0);
  });

  it("cancels native work and errors a response body after headers", async () => {
    const native = new FakeNativeBinding(() => ({ complete: false }));
    setNativeBindingForTesting(native);
    const controller = new AbortController();
    const response = await namedFetch("https://example.com", {
      signal: controller.signal,
    });
    const reason = new Error("body cancelled");

    controller.abort(reason);

    await expect(response.text()).rejects.toBe(reason);
    expect(native.cancelled).toEqual([1n]);
  });

  it("validates impersonation option types before native work", async () => {
    const native = new FakeNativeBinding();
    setNativeBindingForTesting(native);

    await expect(namedFetch("https://example.com", { timeout: -1 })).rejects.toThrow(
      "timeout must be a finite, non-negative number",
    );
    expect(native.requests).toHaveLength(0);
  });
});
