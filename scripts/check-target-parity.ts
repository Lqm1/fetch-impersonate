import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface CurlLock {
  curlCffiParity: {
    version: string;
    source: string;
  };
}

interface PyPiRelease {
  urls: Array<{
    filename: string;
    packagetype: string;
  }>;
}

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(join(root, "vendor", "curl-impersonate.lock.json"), "utf8"),
) as CurlLock;
const targets = JSON.parse(await readFile(join(root, "native-targets.json"), "utf8")) as Record<
  string,
  unknown
>;
const response = await fetch(lock.curlCffiParity.source);

if (!response.ok) {
  throw new Error(`Could not fetch curl_cffi metadata: HTTP ${response.status}`);
}

const release = (await response.json()) as PyPiRelease;
const wheelTargets = new Set(
  release.urls
    .filter(({ packagetype }) => packagetype === "bdist_wheel")
    .map(({ filename }) => targetFromWheel(filename))
    .filter((target): target is string => target !== undefined),
);
const configuredTargets = new Set(Object.keys(targets).filter((target) => !target.startsWith("$")));
const missing = [...wheelTargets].filter((target) => !configuredTargets.has(target));
const extra = [...configuredTargets].filter((target) => !wheelTargets.has(target));

if (missing.length > 0 || extra.length > 0) {
  throw new Error(
    `curl_cffi ${lock.curlCffiParity.version} target parity failed. ` +
      `Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
  );
}

console.log(
  `Target parity verified: ${configuredTargets.size} targets match curl_cffi ${lock.curlCffiParity.version}.`,
);

function targetFromWheel(filename: string): string | undefined {
  if (filename.includes("win_amd64")) return "win32-x64-msvc";
  if (filename.includes("win_arm64")) return "win32-arm64-msvc";
  if (filename.includes("macosx") && filename.includes("x86_64")) return "darwin-x64";
  if (filename.includes("macosx") && filename.includes("arm64")) return "darwin-arm64";
  if (filename.includes("android") && filename.includes("arm64_v8a")) return "android-arm64";
  if (filename.includes("musllinux") && filename.includes("x86_64")) return "linux-x64-musl";
  if (filename.includes("musllinux") && filename.includes("aarch64")) return "linux-arm64-musl";
  if (filename.includes("manylinux") && filename.includes("x86_64")) return "linux-x64-gnu";
  if (filename.includes("manylinux") && filename.includes("aarch64")) return "linux-arm64-gnu";
  if (filename.includes("manylinux") && filename.includes("i686")) return "linux-ia32-gnu";
  if (filename.includes("manylinux") && filename.includes("armv7l")) return "linux-arm-gnueabihf";
  if (filename.includes("manylinux") && filename.includes("riscv64")) return "linux-riscv64-gnu";
  return undefined;
}
