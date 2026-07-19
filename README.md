# fetch-impersonate

`fetch-impersonate` is an ESM-only, Node.js Fetch API transport backed by
`libcurl-impersonate`. It returns the platform's standard `Response` and uses
standard `Request`, `Headers`, `ReadableStream`, and `AbortSignal` objects.

The complete public runtime API is `fetch` and `createFetch`:

```ts
import fetch, {
  fetch as impersonateFetch,
  createFetch,
} from "fetch-impersonate";

const response = await fetch("https://example.com", {
  impersonate: "chrome",
});

console.log(response.status, await response.text());
```

Node.js 20 or newer is required.

## API

### `fetch(input, init)`

The arguments and result follow the standard Fetch API. The following
transport options extend `RequestInit`:

```ts
interface ImpersonateOptions {
  impersonate?: ImpersonateTarget;
  defaultHeaders?: boolean;
  proxy?: string;
  timeout?: number;        // milliseconds
  connectTimeout?: number; // milliseconds
  httpVersion?: "auto" | "1.1" | "2" | "3";
  ja3?: string;
  akamai?: string;
  extraFp?: ExtraFingerprintOptions;
}
```

When `impersonate` is set, browser default headers are enabled unless
`defaultHeaders` is explicitly `false`. Per-request headers still pass through
the standard `Headers` normalization performed by `Request`.

Request bodies including strings, `URLSearchParams`, `Blob`, `ArrayBuffer`, and
`FormData` are supported. Request bodies are buffered before native transfer;
response bodies are streamed.

### `createFetch(defaults?)`

`createFetch` captures only `ImpersonateOptions` and returns a regular fetch
function. Per-request transport options override captured defaults:

```ts
const browserFetch = createFetch({
  impersonate: "chrome",
  defaultHeaders: true,
});

await browserFetch("https://example.com");
await browserFetch("https://example.com", { impersonate: "firefox" });
```

It does not create a client, session, cookie jar, native handle, or additional
connection pool. Standard options such as `headers`, `method`, and `body`
cannot be captured as defaults.

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

## ky and Axios

Use `createFetch` when the calling library cannot forward custom request
options:

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

## Fetch behavior

- The fetch promise resolves when final response headers are available.
- The response body uses a bounded native queue with curl pause/resume
  backpressure.
- `follow`, `manual`, and `error` redirect modes are supported.
- HTTP statuses such as 404 and 500 resolve normally.
- DNS, TLS, connection, timeout, and mid-body failures become
  `TypeError("fetch failed")`; structured curl details are stored in `cause`.
- Aborts preserve `AbortSignal.reason`, including while reading a body.
- `Response.clone()` and `bodyUsed` retain standard behavior.
- No curl cookie engine is enabled. Explicit `Cookie` headers are sent and
  `Set-Cookie` headers are returned, but cookies never persist between calls.

## Native packages

The root package has exact-version optional dependencies on one package for
each target:

| Target | Linkage | Status |
| --- | --- | --- |
| macOS x64 / ARM64 | static curl stack | supported |
| Windows x64 / ARM64 | bundled curl DLL | supported |
| Linux glibc x64 / ARM64 | static curl stack | supported |
| Linux musl x64 / ARM64 | static curl stack | supported |
| Linux glibc i686 / ARMv7 / RISC-V 64 | static curl stack | supported |
| Android ARM64 | static curl stack | experimental |

`native-targets.json` is the source of truth for Rust targets, npm platform
metadata, package names, and linkage policy. CI loads every supported `.node`
file and performs an HTTP request on its native runner or under QEMU. The
Android job additionally loads the ARM64 addon in an Android emulator through
an ARM64 Node runtime.

Package installation performs no download, native compilation, `node-gyp`
fallback, or system-curl fallback. Native assets are selected only from the
installed optional dependency.

## Development

Native curl artifacts are pinned by release, commit, and SHA-256 in
`vendor/curl-impersonate.lock.json`. Fetching them is an explicit development
or CI action:

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

Useful repository checks include:

```sh
pnpm typecheck
pnpm check:bindings
pnpm check:package-metadata
pnpm check:target-parity
pnpm check:fingerprint
```

Generated Rust FFI declarations and their exact upstream curl headers are
committed. `generate:bindings` is an explicit maintainer tool and is never run
on an installer's machine.

The native layer creates one lazily initialized reactor per Node-API
environment. That reactor owns a single curl multi handle, a command queue,
and active easy handles. `createFetch()` remains a TypeScript closure and does
not allocate native state.
