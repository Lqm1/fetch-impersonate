# Contributing to fetch-impersonate

Thank you for your interest in contributing! This document explains how to set up a development environment, make changes, and get them merged.

## Table of contents

- [Project overview](#project-overview)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Development workflow](#development-workflow)
- [Working on the native layer](#working-on-the-native-layer)
- [Checks and tests](#checks-and-tests)
- [Commit conventions](#commit-conventions)
- [Submitting a pull request](#submitting-a-pull-request)
- [Adding or changing a native target](#adding-or-changing-a-native-target)
- [Reporting issues](#reporting-issues)

## Project overview

fetch-impersonate is a hybrid TypeScript / Rust project:

| Path | Purpose |
| --- | --- |
| `src/` | Public TypeScript API (`fetch`, `createFetch`) and internal request/response normalization |
| `crates/native/` | Rust Node-API addon wrapping libcurl-impersonate |
| `scripts/` | Build, packaging, verification, and smoke-test tooling (run with `tsx`) |
| `npm/` | Per-platform native package templates |
| `native-targets.json` | **Source of truth** for Rust targets, npm platform metadata, and linkage policy |
| `vendor/curl-impersonate.lock.json` | Pinned curl-impersonate release, commit, and per-asset SHA-256 hashes |
| `tests/` | Vitest suites: `public-api.test.ts` (no native binary needed) and `native-integration.test.ts` |
| `schemas/` | JSON schemas for repository metadata files |

The TypeScript layer never falls back to system curl: native assets are selected only from the installed platform-specific optional dependency.

## Prerequisites

- **Node.js 20 or newer** (CI runs on Node 24)
- **pnpm 10.13.1** — the version is pinned in `package.json` (`packageManager`), so [Corepack](https://nodejs.org/api/corepack.html) (`corepack enable`) picks it automatically
- **Rust stable** with `rustfmt` and `clippy` components — required for typechecking the native crate and for any native work
- Platform build tools for native builds only: MSVC Build Tools on Windows, Xcode Command Line Tools on macOS, `gcc`/`make` on Linux

## Getting started

```sh
git clone https://github.com/Lqm1/fetch-impersonate
cd fetch-impersonate
pnpm install
```

Package installation never downloads curl artifacts. Fetching the pinned artifacts is an explicit step, needed before building the native addon or running native integration tests:

```sh
# Fetch and verify the pinned curl-impersonate artifact for your platform, e.g.:
pnpm exec tsx scripts/prepare-native.ts --target linux-x64-gnu
```

Valid target names are the keys of `native-targets.json` (e.g. `darwin-arm64`, `win32-x64-msvc`, `linux-x64-gnu`). Every artifact is verified against the SHA-256 recorded in `vendor/curl-impersonate.lock.json`.

## Development workflow

Most TypeScript changes don't require a native build:

```sh
pnpm typecheck        # TypeScript, no emit
pnpm test             # Vitest (native integration tests skip if no addon is built)
pnpm test:watch       # Vitest in watch mode
pnpm check:rust       # cargo check with the native-stub feature (no curl needed)
pnpm check            # typecheck + test + check:rust
pnpm build            # compile TypeScript to dist/
```

For native changes, after running `prepare-native.ts` for your platform:

```sh
pnpm build:native     # build the Node-API addon (napi-rs)
pnpm verify:linkage   # assert the addon links curl per the target's linkage policy
pnpm smoke:native     # load the .node file and perform a real HTTP request
pnpm package:native   # assemble the per-platform npm package
pnpm smoke:install    # install the packed package into a temp project and run it
```

## Working on the native layer

- The addon creates one lazily initialized reactor per Node-API environment, owning a single curl multi handle, a command queue, and the active easy handles. Keep this model in mind: `createFetch()` must remain a plain TypeScript closure with no native state.
- Generated Rust FFI declarations and the exact upstream curl headers they came from are **committed**. If you change the bindings surface, regenerate with `pnpm generate:bindings` and verify with `pnpm check:bindings`. `generate:bindings` is a maintainer tool and must never run on an installer's machine.
- The crate must keep compiling without curl via the stub feature: `pnpm check:rust` (this is what CI's clippy job uses too).

## Checks and tests

CI (`.github/workflows/ci.yml`) runs the following on every pull request — please run them locally first:

```sh
pnpm typecheck
pnpm test
pnpm check:target-parity      # native-targets.json ⇄ package.json ⇄ npm/ consistency
pnpm check:package-metadata   # package.json invariants (exports, files, versions)
pnpm check:bindings           # committed bindings match the pinned curl headers
cargo fmt --all -- --check
cargo clippy -p fetch-impersonate-native --no-default-features --features native-stub -- -D warnings
```

A separate workflow (`build-native.yml`) builds every native target on its native runner or under QEMU, loads the resulting `.node` file, and performs a real HTTP request; the Android target additionally runs in an emulator (`pnpm smoke:android`). It triggers automatically on pull requests that touch `crates/`, `src/`, `scripts/`, `npm/`, `native-targets.json`, or the curl lock file.

The `fingerprint.yml` workflow (`pnpm check:fingerprint`) validates that impersonation targets still produce the expected TLS/HTTP2 fingerprints.

### Writing tests

- Put tests that exercise the public API without a native binary in `tests/public-api.test.ts`.
- Put tests that require the built addon and network access in `tests/native-integration.test.ts`; they must skip cleanly when the addon isn't built.

## Commit conventions

This repository uses [Conventional Commits](https://www.conventionalcommits.org/) with a scope:

```
<type>(<scope>): <imperative, lower-case summary>
```

Types in use: `feat`, `fix`, `docs`, `test`, `build`, `ci`, `refactor`, `chore`. Examples from the history:

```
fix(package): add repository field for npm provenance verification
ci(release): map prerelease channels (alpha/beta/rc) to matching npm dist-tags
docs(readme): restructure README with badges, feature highlights, and installation guide
```

Keep commits focused: one logical change per commit.

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes, including tests for new behavior.
3. Run the [local checks](#checks-and-tests) relevant to what you touched.
4. Update `README.md` if you changed the public API or supported platforms.
5. Open the pull request against `main` with a clear description of **what** changed and **why**.

> [!NOTE]
> Versioning, changelog, npm publishing, and dist-tag management are handled by maintainers through the release workflow. Don't bump versions or edit `optionalDependencies` versions in a feature PR.

A maintainer will review your PR; CI must be green before merge.

## Adding or changing a native target

`native-targets.json` is the single source of truth. A target change usually touches, in this order:

1. `native-targets.json` — Rust target, npm `os`/`cpu`/`libc`, linkage policy, curl asset platform (validated by `schemas/`).
2. `vendor/curl-impersonate.lock.json` — the pinned asset name and SHA-256 for the new platform.
3. `package.json` — the `napi.targets` list and the matching `optionalDependencies` entry.
4. `.github/workflows/build-native.yml` — a matrix entry with a native runner or QEMU setup.

Then verify consistency end to end:

```sh
pnpm check:target-parity
pnpm exec tsx scripts/prepare-native.ts --target <new-target>
pnpm build:native:target <new-target>
pnpm verify:linkage
pnpm smoke:native
```

New targets should start as `"experimental": true` until they have passed CI smoke tests over several releases.

## Reporting issues

When filing a bug report, please include:

- Operating system, architecture, and libc (glibc/musl) where relevant
- Node.js and fetch-impersonate versions
- The `impersonate` target and transport options used
- A minimal reproduction — ideally a single `fetch()` call against a public endpoint
- For request failures: the `TypeError("fetch failed")` `cause` value, which carries structured curl details

Security-sensitive reports (e.g. issues in TLS handling or the vendored curl stack) should not be filed as public issues — use GitHub's private vulnerability reporting on the repository instead.
