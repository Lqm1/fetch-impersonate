import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rename, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { spawnSync } from "node:child_process";

interface LockedArtifact {
  asset: string;
  sha256: string;
}

interface CurlLock {
  repository: string;
  tag: string;
  artifacts: Record<string, LockedArtifact>;
}

const root = resolve(import.meta.dirname, "..");
const lock = JSON.parse(
  await readFile(join(root, "vendor", "curl-impersonate.lock.json"), "utf8"),
) as CurlLock;
const target = readTargetArgument() ?? detectTarget();
const artifact = lock.artifacts[target];

if (artifact === undefined) {
  throw new Error(`No locked curl-impersonate artifact exists for ${target}`);
}

const destination = join(root, "vendor", "artifacts", target, lock.tag);
const marker = join(destination, ".fetch-impersonate-artifact");

if (await pathExists(marker)) {
  console.log(`curl-impersonate is already prepared at ${destination}`);
  process.exit(0);
}

if (await pathExists(destination)) {
  throw new Error(`Refusing to overwrite incomplete artifact directory: ${destination}`);
}

const downloadDirectory = join(root, "vendor", "artifacts", ".downloads");
await mkdir(downloadDirectory, { recursive: true });
const archive = join(downloadDirectory, artifact.asset);

if (!(await pathExists(archive))) {
  const repositoryPath = new URL(lock.repository).pathname.replace(/^\//, "");
  const url = `https://github.com/${repositoryPath}/releases/download/${lock.tag}/${artifact.asset}`;
  console.log(`Downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || response.body === null) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }
  await finished(
    Readable.from(response.body as AsyncIterable<Uint8Array>).pipe(
      createWriteStream(archive, { flags: "wx" }),
    ),
  );
}

const digest = await sha256(archive);
if (digest !== artifact.sha256) {
  throw new Error(
    `SHA-256 mismatch for ${basename(archive)}: expected ${artifact.sha256}, got ${digest}`,
  );
}

const extractionRoot = await mkdtemp(join(root, "vendor", "artifacts", ".extract-"));
const extraction = spawnSync("tar", ["-xzf", archive, "-C", extractionRoot], {
  encoding: "utf8",
});
if (extraction.status !== 0) {
  throw new Error(`Could not extract ${archive}: ${extraction.stderr}`);
}

await validateExtractedArtifact(extractionRoot);
await mkdir(join(root, "vendor", "artifacts", target), { recursive: true });
await rename(extractionRoot, destination);
await access(join(destination, "include", "curl", "curl.h"));
await writeMarker(marker, `${artifact.sha256}\n`);
console.log(`Prepared ${target} at ${destination}`);

async function writeMarker(path: string, content: string): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, content, { flag: "wx" });
}

async function validateExtractedArtifact(directory: string): Promise<void> {
  await access(join(directory, "include", "curl", "curl.h"));
  const entries = [
    join(directory, "libcurl-impersonate.a"),
    join(directory, "libcurl-impersonate.dll"),
    join(directory, "libcurl-impersonate_imp.lib"),
    join(directory, "lib", "libcurl-impersonate.a"),
    join(directory, "lib", "libcurl-impersonate.dll"),
    join(directory, "lib", "libcurl-impersonate_imp.lib"),
  ];
  const found = await Promise.all(entries.map(pathExists));
  if (!found.some(Boolean)) {
    throw new Error("The archive contains no recognized libcurl-impersonate library");
  }
}

async function sha256(path: string): Promise<string> {
  const data = await readFile(path);
  return createHash("sha256").update(data).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function readTargetArgument(): string | undefined {
  const index = process.argv.indexOf("--target");
  return index === -1 ? undefined : process.argv[index + 1];
}

function detectTarget(): string {
  if (process.platform === "win32") {
    return `win32-${process.arch}-msvc`;
  }
  if (process.platform === "darwin") {
    return `darwin-${process.arch}`;
  }
  if (process.platform === "android") {
    return `android-${process.arch}`;
  }
  if (process.platform === "linux") {
    const report = process.report?.getReport() as
      | { header?: { glibcVersionRuntime?: string } }
      | undefined;
    const libc = report?.header?.glibcVersionRuntime === undefined ? "musl" : "gnu";
    return `linux-${process.arch}-${libc}`;
  }
  throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
}
