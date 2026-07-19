import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

interface PackResult {
  filename: string;
}

interface PackageJson {
  name: string;
}

const root = resolve(import.meta.dirname, "..");
const target = detectTarget();
const nativeDirectory = join(root, "npm", `native-${target}`);
const nativePackage = JSON.parse(
  await readFile(join(nativeDirectory, "package.json"), "utf8"),
) as PackageJson;
const artifactParent = join(root, ".artifacts");
await mkdir(artifactParent, { recursive: true });
const packDirectory = await mkdtemp(join(artifactParent, "smoke-"));
const installDirectory = await mkdtemp(join(tmpdir(), "fetch-impersonate-smoke-"));

try {
  await run("pnpm", ["run", "build:ts"], root);
  const nativeTarball = await pack(nativeDirectory, packDirectory);
  const rootTarball = await pack(root, packDirectory);
  await writeFile(
    join(installDirectory, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      dependencies: {
        "fetch-impersonate": `file:${join(packDirectory, rootTarball)}`,
        [nativePackage.name]: `file:${join(packDirectory, nativeTarball)}`,
      },
    }, null, 2),
  );
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], installDirectory);
  await run(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `import { createServer } from "node:http";
       import fetch from "fetch-impersonate";
       const server = createServer((_request, response) => response.end("packed"));
       await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
       const address = server.address();
       const response = await fetch("http://127.0.0.1:" + address.port, { impersonate: "chrome" });
       if (response.status !== 200 || await response.text() !== "packed") process.exitCode = 1;
       await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));`,
    ],
    installDirectory,
  );
  console.log(`Clean-install smoke test passed for ${target}.`);
} finally {
  await rm(installDirectory, { recursive: true, force: true });
}

async function pack(directory: string, destination: string): Promise<string> {
  const output = await run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    directory,
  );
  const result = JSON.parse(output) as PackResult[];
  const filename = result[0]?.filename;
  if (filename === undefined) throw new Error(`npm pack returned no filename for ${directory}`);
  return filename;
}

async function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    let executable = command;
    let executableArguments = args;
    if (process.platform === "win32" && command === "npm") {
      executable = process.execPath;
      executableArguments = [
        join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
        ...args,
      ];
    } else if (process.platform === "win32" && command === "pnpm") {
      executable = "pnpm.exe";
    }
    const child = spawn(executable, executableArguments, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun(stdout);
      else rejectRun(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
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
