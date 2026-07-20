import { existsSync } from "node:fs";
import { copyFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

interface NativeTarget {
  rustTarget: string;
}

const root = resolve(import.meta.dirname, "..");
const target = readTargetArgument() ?? detectTarget();
const targets = JSON.parse(await readFile(join(root, "native-targets.json"), "utf8")) as Record<
  string,
  NativeTarget
>;
const config = targets[target];
if (config === undefined) throw new Error(`Unknown native target: ${target}`);

run("rustup", ["target", "add", config.rustTarget]);
const environment = configureCompilers(target, config.rustTarget);
if (target === "android-arm64") {
  run(
    "cargo",
    ["build", "--release", "--package", "fetch-impersonate-native", "--target", config.rustTarget],
    environment,
  );
  await copyFile(
    join(root, "target", config.rustTarget, "release", "libfetch_impersonate_native.so"),
    join(root, "crates", "native", `fetch-impersonate.${target}.node`),
  );
} else {
  run(
    process.platform === "win32" ? "pnpm.exe" : "pnpm",
    [
      "exec",
      "napi",
      "build",
      "--platform",
      "--release",
      "--manifest-path",
      "crates/native/Cargo.toml",
      "--package-json-path",
      "package.json",
      "--output-dir",
      "crates/native",
      "--target",
      config.rustTarget,
    ],
    environment,
  );
}

function configureCompilers(target: string, rustTarget: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  const targetKey = rustTarget.replaceAll("-", "_");
  const cargoKey = rustTarget.replaceAll("-", "_").toUpperCase();
  const crossCompilers: Record<string, readonly [string, string]> = {
    "linux-ia32-gnu": ["i686-linux-gnu-gcc", "i686-linux-gnu-g++"],
    "linux-arm-gnueabihf": ["arm-linux-gnueabihf-gcc", "arm-linux-gnueabihf-g++"],
    "linux-riscv64-gnu": ["riscv64-linux-gnu-gcc", "riscv64-linux-gnu-g++"],
  };
  const compilers = crossCompilers[target];
  if (compilers !== undefined) {
    environment[`CC_${targetKey}`] = compilers[0];
    environment[`CXX_${targetKey}`] = compilers[1];
    environment[`CARGO_TARGET_${cargoKey}_LINKER`] = compilers[0];
  }

  if (target === "android-arm64") {
    const ndk = process.env.ANDROID_NDK_HOME ?? process.env.ANDROID_NDK_ROOT;
    if (ndk === undefined) {
      throw new Error("ANDROID_NDK_HOME must point to an installed Android NDK");
    }
    const prebuilt =
      process.platform === "win32"
        ? "windows-x86_64"
        : process.platform === "darwin"
          ? "darwin-x86_64"
          : "linux-x86_64";
    const suffix = process.platform === "win32" ? ".cmd" : "";
    const bin = join(ndk, "toolchains", "llvm", "prebuilt", prebuilt, "bin");
    const cc = join(bin, `aarch64-linux-android24-clang${suffix}`);
    const cxx = join(bin, `aarch64-linux-android24-clang++${suffix}`);
    const archiveTool = join(bin, process.platform === "win32" ? "llvm-ar.exe" : "llvm-ar");
    if (!existsSync(cc) || !existsSync(cxx) || !existsSync(archiveTool)) {
      throw new Error(`Android NDK compilers are missing below ${bin}`);
    }
    environment[`CC_${targetKey}`] = cc;
    environment[`CXX_${targetKey}`] = cxx;
    environment[`AR_${targetKey}`] = archiveTool;
    environment[`CARGO_TARGET_${cargoKey}_LINKER`] = cc;
    environment.ANDROID_NDK_LATEST_HOME = ndk;
  }
  return environment;
}

function run(command: string, args: string[], environment = process.env): void {
  const result = spawnSync(command, args, {
    cwd: root,
    env: environment,
    stdio: "inherit",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
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
    return `linux-${process.arch}-${report?.header?.glibcVersionRuntime === undefined ? "musl" : "gnu"}`;
  }
  throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
}
