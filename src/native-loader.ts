import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  NativeBinding,
  NativeEvent,
  NativeRequest,
  NativeVersionInfo,
} from "./internal/native-types.js";

interface RawNativeBinding {
  startRequest(request: NativeRequest, listener: (serializedEvent: string) => void): bigint;
  readBody(transferId: bigint): Uint8Array | null;
  cancelRequest(transferId: bigint): void;
  version(): NativeVersionInfo;
}

const require = createRequire(import.meta.url);
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

let cachedBinding: NativeBinding | undefined;

export function getNativeBinding(): NativeBinding {
  cachedBinding ??= loadNativeBinding();
  return cachedBinding;
}

export function setNativeBindingForTesting(binding: NativeBinding | undefined): void {
  cachedBinding = binding;
}

function loadNativeBinding(): NativeBinding {
  const target = detectNativeTarget();
  const packageName = `@fetch-impersonate/native-${target}`;
  const localCandidates = [
    join(moduleDirectory, `fetch-impersonate.${target}.node`),
    join(moduleDirectory, "..", `fetch-impersonate.${target}.node`),
    join(moduleDirectory, "..", "crates", "native", `fetch-impersonate.${target}.node`),
  ];
  const errors: unknown[] = [];

  for (const candidate of localCandidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    try {
      return assertNativeBinding(require(candidate));
    } catch (error) {
      errors.push(error);
    }
  }

  try {
    return assertNativeBinding(require(packageName));
  } catch (error) {
    errors.push(error);
  }

  const cause = errors.at(-1);
  throw new Error(
    `No native fetch-impersonate binding is available for ${target}. ` +
      `Reinstall fetch-impersonate with optional dependencies enabled.`,
    { cause },
  );
}

function assertNativeBinding(value: unknown): NativeBinding {
  const candidate = unwrapDefault(value);

  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof Reflect.get(candidate, "startRequest") !== "function" ||
    typeof Reflect.get(candidate, "readBody") !== "function" ||
    typeof Reflect.get(candidate, "cancelRequest") !== "function" ||
    typeof Reflect.get(candidate, "version") !== "function"
  ) {
    throw new TypeError("The native package exports an invalid binding");
  }

  const raw = candidate as RawNativeBinding;
  return {
    startRequest(request, listener) {
      return raw.startRequest(request, (serializedEvent) => {
        listener(parseNativeEvent(serializedEvent));
      });
    },
    readBody(transferId) {
      return raw.readBody(transferId);
    },
    cancelRequest(transferId) {
      raw.cancelRequest(transferId);
    },
    version() {
      return raw.version();
    },
  };
}

function parseNativeEvent(serializedEvent: string): NativeEvent {
  const event = JSON.parse(serializedEvent) as Record<string, unknown>;
  if (typeof event.transferId !== "string") {
    throw new TypeError("Native event contains an invalid transfer id");
  }
  return {
    ...event,
    transferId: BigInt(event.transferId),
  } as unknown as NativeEvent;
}

function unwrapDefault(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "default" in value) {
    return Reflect.get(value, "default");
  }
  return value;
}

function detectNativeTarget(): string {
  const platform = process.platform;
  const architecture = normalizeArchitecture(process.arch);

  if (platform === "win32") {
    return `win32-${architecture}-msvc`;
  }

  if (platform === "darwin") {
    return `darwin-${architecture}`;
  }

  if (platform === "android") {
    return `android-${architecture}`;
  }

  if (platform === "linux") {
    return `linux-${architecture}-${detectLinuxLibc()}`;
  }

  throw new Error(`Unsupported platform: ${platform}-${process.arch}`);
}

function normalizeArchitecture(architecture: NodeJS.Architecture): string {
  switch (architecture) {
    case "x64":
    case "arm64":
    case "ia32":
    case "riscv64":
    case "loong64":
      return architecture;
    case "arm":
      return "arm-gnueabihf";
    default:
      throw new Error(`Unsupported architecture: ${architecture}`);
  }
}

function detectLinuxLibc(): "gnu" | "musl" {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  const header = report?.header;
  return header?.glibcVersionRuntime === undefined ? "musl" : "gnu";
}
