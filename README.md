# fetch-impersonate

[![NPM version](https://img.shields.io/npm/v/fetch-impersonate.svg)](https://www.npmjs.com/package/fetch-impersonate)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Lqm1/fetch-impersonate/ci.yml?branch=main)](https://github.com/Lqm1/fetch-impersonate/actions)
![Node version](https://img.shields.io/node/v/fetch-impersonate)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A [Fetch API](https://developer.mozilla.org/docs/Web/API/Fetch_API)-compatible HTTP transport for Node.js, powered by [libcurl-impersonate](https://github.com/lexiforest/curl-impersonate). It sends requests with the exact TLS and HTTP/2 fingerprints of real browsers, while keeping the standard `fetch` surface you already know: `Request`, `Response`, `Headers`, `ReadableStream`, and `AbortSignal`.

```ts
import fetch from "fetch-impersonate";

const response = await fetch("https://example.com", {
  impersonate: "chrome",
});

console.log(response.status, await response.text());
```

## Features

- **Drop-in Fetch API**: standard arguments, standard `Response`, streaming bodies, redirects, and abort support — plus a handful of transport options on `RequestInit`.
- **Browser impersonation**: Chrome, Firefox, Safari, Edge, and Tor fingerprints (TLS/JA3, HTTP/2 Akamai), with generic aliases like `"chrome"` or pinned versions like `"chrome145"`.
- **Prebuilt native binaries**: a Rust + libcurl-impersonate addon shipped as per-platform npm packages — installation never downloads, compiles, or falls back to system curl.
- **Works with HTTP clients**: plug into [ky](https://github.com/sindresorhus/ky), [Axios](https://github.com/axios/axios), or any library that accepts a custom `fetch`.
- **Fine-grained control**: proxies, timeouts, HTTP version selection, custom JA3/Akamai strings, and low-level TLS/HTTP2 fingerprint tweaks.

> [!IMPORTANT]
> This package is ESM-only and requires Node.js 20 or newer.

## Installation

```sh
npm install fetch-impersonate
```

The correct native binary for your platform is selected automatically from an exact-version optional dependency. No postinstall scripts, no `node-gyp`, no network access at install time.

## Usage

### `fetch(input, init?)`

The arguments and result follow the standard Fetch API. These transport options extend `RequestInit`:

```ts
interface ImpersonateOptions {
  impersonate?: ImpersonateTarget; // e.g. "chrome", "firefox", "safari_ios", "chrome145"
  defaultHeaders?: boolean; // send the browser's default headers (default: true when impersonating)
  proxy?: string; // e.g. "http://user:pass@host:port"
  timeout?: number; // total request timeout, milliseconds
  connectTimeout?: number; // connection timeout, milliseconds
  httpVersion?: "auto" | "1.1" | "2" | "3";
  ja3?: string; // custom JA3 TLS fingerprint string
  akamai?: string; // custom Akamai HTTP/2 fingerprint string
  extraFp?: ExtraFingerprintOptions;
}
```

When `impersonate` is set, browser default headers are enabled unless `defaultHeaders` is explicitly `false`. Per-request headers still go through the standard `Headers` normalization performed by `Request`.

Request bodies including strings, `URLSearchParams`, `Blob`, `ArrayBuffer`, and `FormData` are supported. Request bodies are buffered before the native transfer; response bodies are streamed.

### `createFetch(defaults?)`

`createFetch` captures `ImpersonateOptions` defaults and returns a regular fetch function. Per-request transport options override the captured defaults:

```ts
import { createFetch } from "fetch-impersonate";

const browserFetch = createFetch({ impersonate: "chrome" });

await browserFetch("https://example.com");
await browserFetch("https://example.com", { impersonate: "firefox" });
```

> [!NOTE]
> `createFetch` is a plain TypeScript closure: it does not create a client, session, cookie jar, native handle, or connection pool. Standard options such as `headers`, `method`, and `body` cannot be captured as defaults.

### Impersonation targets

Generic aliases track the newest supported browser version, and pinned targets select a specific one:

| Alias                                 | Pinned examples                               |
| ------------------------------------- | --------------------------------------------- |
| `chrome`, `chrome_android`            | `chrome99` … `chrome146`, `chrome131_android` |
| `firefox`                             | `firefox133` … `firefox147`                   |
| `safari`, `safari_ios`, `safari_beta` | `safari153` … `safari2601`, `safari184_ios`   |
| `edge`                                | `edge99`, `edge101`                           |
| `tor`                                 | `tor145`                                      |

The full list is in the [`ImpersonateTarget`](src/options.ts) type.

### Using with ky and Axios

Use `createFetch` when the calling library cannot forward custom request options:

```ts
import ky from "ky";
import { createFetch } from "fetch-impersonate";

const api = ky.create({
  fetch: createFetch({ impersonate: "chrome" }),
});
```

```ts
import axios from "axios";
import { createFetch } from "fetch-impersonate";

const api = axios.create({
  adapter: "fetch",
  env: {
    fetch: createFetch({ impersonate: "chrome" }),
    Request: globalThis.Request,
    Response: globalThis.Response,
  },
});
```

### Type exports

The package exports these TypeScript types without adding runtime exports:

```ts
import type {
  ExtraFingerprintOptions,
  ImpersonateFetch,
  ImpersonateOptions,
  ImpersonateRequestInit,
  ImpersonateTarget,
} from "fetch-impersonate";
```

## Fetch behavior

- The fetch promise resolves when final response headers are available.
- The response body uses a bounded native queue with curl pause/resume backpressure.
- `follow`, `manual`, and `error` redirect modes are supported.
- HTTP statuses such as 404 and 500 resolve normally.
- DNS, TLS, connection, timeout, and mid-body failures become `TypeError("fetch failed")`; structured curl details are stored in `cause`.
- Aborts preserve `AbortSignal.reason`, including while reading a body.
- `Response.clone()` and `bodyUsed` retain standard behavior.

> [!NOTE]
> No curl cookie engine is enabled. Explicit `Cookie` headers are sent and `Set-Cookie` headers are returned, but cookies never persist between calls. Bring your own cookie jar if you need session persistence.

## Supported platforms

The root package has exact-version optional dependencies on one native package per target:

| Target                               | Linkage           | Status       |
| ------------------------------------ | ----------------- | ------------ |
| macOS x64 / ARM64                    | static curl stack | supported    |
| Windows x64 / ARM64                  | bundled curl DLL  | supported    |
| Linux glibc x64 / ARM64              | static curl stack | supported    |
| Linux musl x64 / ARM64               | static curl stack | supported    |
| Linux glibc i686 / ARMv7 / RISC-V 64 | static curl stack | supported    |
| Android ARM64                        | static curl stack | experimental |

[`native-targets.json`](native-targets.json) is the source of truth for Rust targets, npm platform metadata, package names, and linkage policy. CI loads every supported `.node` file and performs an HTTP request on its native runner or under QEMU; the Android job additionally loads the ARM64 addon in an Android emulator through an ARM64 Node runtime.

## How it works

The native layer is a [napi-rs](https://napi.rs) addon that creates one lazily initialized reactor per Node-API environment. The reactor owns a single curl multi handle, a command queue, and the active easy handles. Native curl artifacts are pinned by release, commit, and SHA-256 in [`vendor/curl-impersonate.lock.json`](vendor/curl-impersonate.lock.json).

## Development

Fetching the pinned curl artifacts is an explicit development or CI action:

```sh
pnpm install
pnpm exec tsx scripts/prepare-native.ts
pnpm build:native
pnpm package:native
pnpm verify:linkage
pnpm test
pnpm smoke:native
pnpm smoke:install
```

Useful repository checks:

```sh
pnpm typecheck
pnpm check:bindings
pnpm check:package-metadata
pnpm check:target-parity
pnpm check:fingerprint
```

Generated Rust FFI declarations and their exact upstream curl headers are committed. `generate:bindings` is an explicit maintainer tool and is never run on an installer's machine.

## Acknowledgements

- [lexiforest/curl-impersonate](https://github.com/lexiforest/curl-impersonate) — the actively maintained curl-impersonate fork that powers this project's native transport and browser fingerprints.
- [lexiforest/curl_cffi](https://github.com/lexiforest/curl_cffi) — the Python binding for curl-impersonate, whose package structure served as a reference for this project.

## Disclaimer

This project is not affiliated with or endorsed by any browser vendor. Impersonation targets mimic browser network fingerprints only; they do not replicate browser behavior beyond the transport layer. Use this library responsibly and in compliance with the terms of service of the websites you access and all applicable laws.
