import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface NativeTarget {
  link: "static" | "dynamic";
}

interface CurlLock {
  tag: string;
}

interface PackageJson {
  name: string;
  version: string;
}

const root = resolve(import.meta.dirname, "..");
const target = readTargetArgument() ?? detectTarget();
const targets = JSON.parse(await readFile(join(root, "native-targets.json"), "utf8")) as Record<
  string,
  NativeTarget
>;
const targetConfig = targets[target];
if (targetConfig === undefined) {
  throw new Error(`Unknown native target: ${target}`);
}

const lock = JSON.parse(
  await readFile(join(root, "vendor", "curl-impersonate.lock.json"), "utf8"),
) as CurlLock;
const rootPackage = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as PackageJson;
const packageDirectory = join(root, "npm", `native-${target}`);
const nativePackage = JSON.parse(
  await readFile(join(packageDirectory, "package.json"), "utf8"),
) as PackageJson;

if (nativePackage.version !== rootPackage.version) {
  throw new Error(
    `${nativePackage.name} version ${nativePackage.version} does not match root ${rootPackage.version}`,
  );
}

await mkdir(packageDirectory, { recursive: true });
await copyFile(
  join(root, "crates", "native", `fetch-impersonate.${target}.node`),
  join(packageDirectory, `fetch-impersonate.${target}.node`),
);
await copyFile(join(root, "LICENSE"), join(packageDirectory, "LICENSE"));
await copyFile(
  join(root, "vendor", "licenses", "curl-impersonate-LICENSE"),
  join(packageDirectory, "THIRD_PARTY_NOTICES"),
);
await writeFile(
  join(packageDirectory, "README.md"),
  `# ${nativePackage.name}\n\nThis is the ${target} native binary for fetch-impersonate. It is installed automatically; do not depend on it directly.\n`,
);

if (targetConfig.link === "dynamic") {
  await copyFile(
    join(root, "vendor", "artifacts", target, lock.tag, "lib", "libcurl-impersonate.dll"),
    join(packageDirectory, "libcurl-impersonate.dll"),
  );
}

console.log(`Packaged ${nativePackage.name} for ${target}.`);

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
