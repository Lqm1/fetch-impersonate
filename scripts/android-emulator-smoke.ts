import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface LockedDownload {
  file: string;
  url: string;
  sha256: string;
}

interface AndroidSmokeLock {
  termuxApp: LockedDownload;
  termuxPackages: LockedDownload[];
}

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(join(root, "vendor", "android-smoke.lock.json"), "utf8"),
) as AndroidSmokeLock;
const work = join(root, ".artifacts", "android-emulator-smoke");
const downloads = join(work, "downloads");
const extracted = join(work, "root");
const bundle = join(work, "a64.tar");
const addon = join(root, "crates", "native", "fetch-impersonate.android-arm64.node");

await rm(work, { recursive: true, force: true });
await mkdir(downloads, { recursive: true });
await lstat(addon);

const abiList = runCapture("adb", ["shell", "getprop", "ro.product.cpu.abilist"]);
if (!abiList.split(",").includes("arm64-v8a")) {
  throw new Error(`Android emulator has no ARM64 translation ABI: ${abiList}`);
}

const app = await downloadLocked(lock.termuxApp);
run("adb", ["install", "-r", app]);
run("adb", ["shell", "am", "start", "-n", "com.termux/.app.TermuxActivity"]);
await waitForTermuxBootstrap();

for (const packageDownload of lock.termuxPackages) {
  const archive = await downloadLocked(packageDownload);
  run("dpkg-deb", ["-x", archive, extracted]);
}

const prefix = join(extracted, "data", "data", "com.termux", "files", "usr");
await replacePrefix(prefix);

const smokeRoot = join(prefix, "smoke");
const nativePackage = join(smokeRoot, "npm", "native-android-arm64");
await mkdir(join(smokeRoot, "scripts"), { recursive: true });
await mkdir(nativePackage, { recursive: true });
await copyFile(
  join(root, "scripts", "native-smoke.cjs"),
  join(smokeRoot, "scripts", "native-smoke.cjs"),
);
await copyFile(
  join(root, "npm", "native-android-arm64", "package.json"),
  join(nativePackage, "package.json"),
);
await copyFile(addon, join(nativePackage, "fetch-impersonate.android-arm64.node"));

run("tar", ["-cf", bundle, "-C", prefix, "."]);
run("adb", ["push", bundle, "/data/local/tmp/fetch-impersonate-a64.tar"]);
runAdbShell("run-as com.termux mkdir -p files/a64");
runAdbShell(
  "run-as com.termux files/usr/bin/tar -xf /data/local/tmp/fetch-impersonate-a64.tar -C files/a64",
);
runAdbShell("run-as com.termux chmod 700 files/a64/bin/node");
runAdbShell(
  "run-as com.termux /system/bin/sh -c 'export OPENSSL_armcap=0; exec /data/data/com.termux/files/a64/bin/node /data/data/com.termux/files/a64/smoke/scripts/native-smoke.cjs --target android-arm64'",
);

console.log("Android ARM64 translated-runtime smoke test passed.");

async function downloadLocked(download: LockedDownload): Promise<string> {
  const destination = join(downloads, download.file);
  const response = await fetch(download.url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed for ${download.url}: HTTP ${response.status}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== download.sha256) {
    throw new Error(
      `SHA-256 mismatch for ${download.file}: expected ${download.sha256}, got ${digest}`,
    );
  }
  await writeFile(destination, bytes, { flag: "wx" });
  return destination;
}

async function waitForTermuxBootstrap(): Promise<void> {
  const deadline = Date.now() + 240_000;
  while (Date.now() < deadline) {
    const result = spawnSync("adb", ["shell", "run-as com.termux test -x files/usr/bin/bash"]);
    if (result.status === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  throw new Error("Termux bootstrap did not complete within four minutes");
}

async function replacePrefix(directory: string): Promise<void> {
  const oldPrefix = Buffer.from("/data/data/com.termux/files/usr");
  const newPrefix = Buffer.from("/data/data/com.termux/files/a64");
  if (oldPrefix.length !== newPrefix.length) {
    throw new Error("Android smoke prefixes must have equal byte lengths");
  }

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await replacePrefix(path);
    } else if (entry.isFile()) {
      const bytes = await readFile(path);
      let offset = bytes.indexOf(oldPrefix);
      let changed = false;
      while (offset !== -1) {
        newPrefix.copy(bytes, offset);
        changed = true;
        offset = bytes.indexOf(oldPrefix, offset + oldPrefix.length);
      }
      if (changed) await writeFile(path, bytes);
    }
  }
}

function runAdbShell(command: string): void {
  run("adb", ["shell", command]);
}

function run(command: string, args: string[]): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status}`);
  }
}

function runCapture(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}
