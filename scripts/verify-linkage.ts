import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

interface NativeTarget {
  link: "static" | "dynamic";
  npmOs: string;
}

const root = resolve(import.meta.dirname, "..");
const target = readTargetArgument() ?? detectTarget();
const targets = JSON.parse(await readFile(join(root, "native-targets.json"), "utf8")) as Record<
  string,
  NativeTarget
>;
const config = targets[target];
if (config === undefined) throw new Error(`Unknown native target: ${target}`);

const binary = join(root, "crates", "native", `fetch-impersonate.${target}.node`);
if (!existsSync(binary)) throw new Error(`Native binary is missing: ${binary}`);

const dependencies = inspectDependencies(binary, config.npmOs).toLowerCase();
if (config.link === "static") {
  const forbidden = [
    "libcurl",
    "libssl",
    "libcrypto",
    "libnghttp2",
    "libbrotli",
    "libzstd",
    ...(config.npmOs === "android" ? ["libc++_shared"] : []),
  ];
  const leaked = forbidden.filter((name) => dependencies.includes(name));
  if (leaked.length > 0) {
    throw new Error(`Static target ${target} leaks shared dependencies: ${leaked.join(", ")}`);
  }
} else {
  if (!dependencies.includes("libcurl-impersonate.dll")) {
    throw new Error(`${target} does not import libcurl-impersonate.dll`);
  }
  const dll = join(root, "npm", `native-${target}`, "libcurl-impersonate.dll");
  if (!existsSync(dll)) throw new Error(`Packaged curl DLL is missing: ${dll}`);
}

console.log(`Linkage policy verified for ${target}.`);

function inspectDependencies(binary: string, os: string): string {
  if (os === "linux" || os === "android") {
    const androidReadelf = os === "android" ? findAndroidReadelf() : undefined;
    return runFirst([
      ...(androidReadelf === undefined ? [] : [[androidReadelf, ["-d", binary]] as const]),
      ["readelf", ["-d", binary]],
      ["llvm-readelf", ["-d", binary]],
    ]);
  }
  if (os === "darwin") return runFirst([["otool", ["-L", binary]]]);
  if (os === "win32") {
    const dumpbin = findDumpbin();
    return runFirst([
      ...(dumpbin === undefined ? [] : [[dumpbin, ["/DEPENDENTS", binary]] as const]),
      ["llvm-objdump", ["-p", binary]],
    ]);
  }
  throw new Error(`No linkage inspector is configured for ${os}`);
}

function findAndroidReadelf(): string | undefined {
  const roots = [process.env.ANDROID_NDK_HOME, process.env.ANDROID_NDK_ROOT].filter(
    (value): value is string => value !== undefined,
  );
  const androidHome = process.env.ANDROID_HOME;
  if (androidHome !== undefined) {
    const ndkRoot = join(androidHome, "ndk");
    if (existsSync(ndkRoot)) {
      roots.push(
        ...readdirSync(ndkRoot)
          .toSorted()
          .toReversed()
          .map((name) => join(ndkRoot, name)),
      );
    }
  }
  const prebuilt =
    process.platform === "win32"
      ? "windows-x86_64"
      : process.platform === "darwin"
        ? "darwin-x86_64"
        : "linux-x86_64";
  const executable = process.platform === "win32" ? "llvm-readelf.exe" : "llvm-readelf";
  return roots
    .map((root) => join(root, "toolchains", "llvm", "prebuilt", prebuilt, "bin", executable))
    .find(existsSync);
}

function findDumpbin(): string | undefined {
  const installer = process.env["ProgramFiles(x86)"];
  if (installer === undefined) return undefined;
  const vswhere = join(installer, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) return undefined;
  const result = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
      "-find",
      "VC\\Tools\\MSVC\\**\\bin\\Hostx64\\x64\\dumpbin.exe",
    ],
    { encoding: "utf8" },
  );
  return result.status === 0 ? result.stdout.trim().split(/\r?\n/).find(Boolean) : undefined;
}

function runFirst(commands: ReadonlyArray<readonly [string, readonly string[]]>): string {
  const failures: string[] = [];
  for (const [command, args] of commands) {
    const result = spawnSync(command, [...args], { encoding: "utf8" });
    if (result.status === 0) return result.stdout;
    failures.push(`${command}: ${result.error?.message ?? result.stderr.trim()}`);
  }
  throw new Error(`Could not inspect native dependencies:\n${failures.join("\n")}`);
}

function readTargetArgument(): string | undefined {
  const index = process.argv.indexOf("--target");
  return index === -1 ? undefined : process.argv[index + 1];
}

function detectTarget(): string {
  if (process.platform === "win32") return `win32-${process.arch}-msvc`;
  if (process.platform === "darwin") return `darwin-${process.arch}`;
  if (process.platform === "android") return `android-${process.arch}`;
  if (process.platform === "linux") {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    const libc = report?.header?.glibcVersionRuntime === undefined ? "musl" : "gnu";
    return `linux-${process.arch}-${libc}`;
  }
  throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
}
