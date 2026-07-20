# AGENTS.md

This file provides guidance to Codex (chatgpt.com/codex) when working with code in this repository.

## What this is

A Fetch API-compatible HTTP transport for Node.js backed by libcurl-impersonate (browser TLS/HTTP2 fingerprint impersonation). Hybrid TypeScript / Rust: the public API is TypeScript (`src/`), the transport is a Rust Node-API addon (`crates/native/`) shipped as prebuilt per-platform npm packages. ESM-only, Node >= 20, pnpm 10.13.1 (pinned via `packageManager`).

## Commands

```sh
pnpm typecheck                # tsc --noEmit
pnpm test                     # vitest run (all tests)
pnpm vitest run tests/public-api.test.ts          # single file
pnpm vitest run -t "pattern"                      # single test by name
pnpm check:rust               # cargo check with native-stub feature (no curl needed)
pnpm check                    # typecheck + test + check:rust
pnpm build                    # tsc -> dist/
```

Most TypeScript work needs no native build: `tests/public-api.test.ts` injects a fake binding via `setNativeBindingForTesting()`, and `tests/native-integration.test.ts` skips when no addon is built.

Native pipeline (only when touching `crates/` or curl vendoring):

```sh
pnpm exec tsx scripts/prepare-native.ts --target <target>   # fetch pinned curl artifact (explicit; install never downloads)
pnpm build:native             # napi build for host platform
pnpm verify:linkage           # assert linkage policy (static vs bundled DLL)
pnpm smoke:native             # load .node + real HTTP request
```

Target names are the keys of `native-targets.json` (e.g. `linux-x64-gnu`, `win32-x64-msvc`, `darwin-arm64`).

CI (`.github/workflows/ci.yml`) additionally runs: `pnpm check:target-parity`, `pnpm check:package-metadata`, `pnpm exec tsx scripts/check-bindings.ts --target linux-x64-gnu`, `cargo fmt --all -- --check`, and `cargo clippy -p fetch-impersonate-native --no-default-features --features native-stub -- -D warnings`.

## Architecture

Request flow: `src/fetch.ts` merges transport defaults (`createFetch` is a plain closure over `fetchWithDefaults` — it must never allocate native state), builds a standard `Request`, and `src/internal/normalize-request.ts` buffers the body into a `NativeRequest`. `startNativeRequest` then runs a small state machine: `binding.startRequest()` returns a `transferId`, native events (`headers` / `body` / `complete` / `error`) arrive as JSON-serialized callbacks, and the response body is a pull-based `ReadableStream` that drains a bounded native queue via `binding.readBody()` — backpressure is curl pause/resume on the native side. The fetch promise resolves at the `headers` event; later failures error the stream instead.

Native binding surface is exactly four functions (`startRequest`, `readBody`, `cancelRequest`, `version`), typed in `src/internal/native-types.ts`. `src/native-loader.ts` detects the platform target (including glibc/musl via `process.report`), tries local dev `.node` files first, then the `@fetch-impersonate/native-<target>` optional dependency. There is deliberately **no fallback** to system curl, node-gyp, or downloads.

Rust side (`crates/native/`): one lazily initialized reactor per Node-API environment (`reactor.rs`) owning a single curl multi handle, a command queue (`command.rs`), and active transfers (`transfer.rs`). FFI declarations in `src/ffi/bindings.rs` are **generated and committed** — regenerate with `pnpm generate:bindings` (maintainer-only), verify with `pnpm check:bindings`. The crate must always compile without curl via the `native-stub` feature.

## Sources of truth

- `native-targets.json` — Rust targets, npm platform metadata, linkage policy per target. Any target change must keep `package.json` (`napi.targets`, `optionalDependencies`), `npm/` package templates, and the `build-native.yml` matrix in sync; `pnpm check:target-parity` enforces this.
- `vendor/curl-impersonate.lock.json` — pinned curl-impersonate release, commit, and per-asset SHA-256. `prepare-native.ts` verifies against it.

## Conventions

- Conventional Commits with scope: `fix(package): ...`, `ci(release): ...`.
- Relative imports use `.js` extensions (ESM, `NodeNext` resolution).
- Cookies are intentionally not persisted (no curl cookie engine); network failures must surface as `TypeError("fetch failed")` with structured curl details in `cause` — preserve these behaviors, they are documented API guarantees in README.md.
- Versioning and publishing are handled by the release workflow; don't bump versions in feature changes.
