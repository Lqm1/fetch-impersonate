import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

interface NativeTarget {
  npmOs: string;
  npmCpu: string;
}

interface PackResult {
  filename: string;
}

const root = resolve(import.meta.dirname, "..");
const target = readArgument("--target") ?? detectTarget();
const output = resolve(root, readArgument("--output") ?? ".artifacts/npm");
const targets = JSON.parse(
  await readFile(join(root, "native-targets.json"), "utf8"),
) as Record<string, NativeTarget>;
if (targets[target] === undefined) throw new Error(`Unknown native target: ${target}`);

await mkdir(output, { recursive: true });
const npmArguments = [
  "pack",
  "--json",
  "--ignore-scripts",
  "--pack-destination",
  output,
  join(root, "npm", `native-${target}`),
];
const executable = process.platform === "win32" ? process.execPath : "npm";
const argumentsForExecutable = process.platform === "win32"
  ? [
      join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      ...npmArguments,
    ]
  : npmArguments;
const result = spawnSync(executable, argumentsForExecutable, {
  cwd: root,
  encoding: "utf8",
});
if (result.error !== undefined) throw result.error;
if (result.status !== 0) {
  throw new Error(`npm pack failed: ${result.stderr || result.stdout}`);
}
const packed = JSON.parse(result.stdout) as PackResult[];
const filename = packed[0]?.filename;
if (filename === undefined) throw new Error("npm pack produced no tarball");
console.log(`Packed ${target} as ${join(output, filename)}.`);

function readArgument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
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
    const architecture = process.arch === "arm" ? "arm-gnueabihf" : process.arch;
    return `linux-${architecture}-${libc}`;
  }
  throw new Error(`Unsupported host: ${process.platform}-${process.arch}`);
}
