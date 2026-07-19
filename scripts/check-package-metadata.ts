import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

interface NativeTarget {
  rustTarget: string;
  npmOs: string;
  npmCpu: string;
  npmLibc?: string;
  link: "dynamic" | "static";
}

interface PackageJson {
  name: string;
  version: string;
  main?: string;
  os?: string[];
  cpu?: string[];
  libc?: string[];
  files?: string[];
  optionalDependencies?: Record<string, string>;
  napi?: { targets?: string[] };
}

const root = resolve(import.meta.dirname, "..");
const targetsDocument = JSON.parse(
  await readFile(join(root, "native-targets.json"), "utf8"),
) as Record<string, NativeTarget | string>;
const targets = Object.fromEntries(
  Object.entries(targetsDocument).filter(([name]) => !name.startsWith("$")),
) as Record<string, NativeTarget>;
const rootPackage = await readPackage(join(root, "package.json"));

const expectedOptionalDependencies = Object.fromEntries(
  Object.keys(targets).map((target) => [
    `@fetch-impersonate/native-${target}`,
    rootPackage.version,
  ]),
);
assertRecordEqual(
  rootPackage.optionalDependencies ?? {},
  expectedOptionalDependencies,
  "root optionalDependencies",
);

assertSetEqual(
  new Set(rootPackage.napi?.targets ?? []),
  new Set(Object.values(targets).map(({ rustTarget }) => rustTarget)),
  "root napi.targets",
);

const actualDirectories = new Set(
  (await readdir(join(root, "npm"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const expectedDirectories = new Set(
  Object.keys(targets).map((target) => `native-${target}`),
);
assertSetEqual(actualDirectories, expectedDirectories, "npm package directories");

for (const [target, config] of Object.entries(targets)) {
  const packageDirectory = join(root, "npm", `native-${target}`);
  const packageJson = await readPackage(join(packageDirectory, "package.json"));
  const main = `fetch-impersonate.${target}.node`;
  const expectedFiles = new Set([
    main,
    "README.md",
    "LICENSE",
    "THIRD_PARTY_NOTICES",
    ...(config.link === "dynamic" ? ["libcurl-impersonate.dll"] : []),
  ]);

  if (packageJson.name !== `@fetch-impersonate/native-${target}`) {
    throw new Error(`${target} has an unexpected package name: ${packageJson.name}`);
  }
  if (packageJson.version !== rootPackage.version) {
    throw new Error(`${target} version does not match the root package`);
  }
  if (packageJson.main !== main) {
    throw new Error(`${target} has an unexpected main entry: ${packageJson.main}`);
  }
  assertSetEqual(new Set(packageJson.os ?? []), new Set([config.npmOs]), `${target} os`);
  assertSetEqual(new Set(packageJson.cpu ?? []), new Set([config.npmCpu]), `${target} cpu`);
  assertSetEqual(
    new Set(packageJson.libc ?? []),
    new Set(
      config.npmOs === "linux" && config.npmLibc !== undefined
        ? [config.npmLibc]
        : [],
    ),
    `${target} libc`,
  );
  assertSetEqual(new Set(packageJson.files ?? []), expectedFiles, `${target} files`);
}

console.log(
  `Package metadata verified for ${Object.keys(targets).length} native targets.`,
);

async function readPackage(path: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path, "utf8")) as PackageJson;
}

function assertRecordEqual(
  actual: Record<string, string>,
  expected: Record<string, string>,
  label: string,
): void {
  const actualEntries = Object.entries(actual).sort();
  const expectedEntries = Object.entries(expected).sort();
  if (JSON.stringify(actualEntries) !== JSON.stringify(expectedEntries)) {
    throw new Error(`${label} does not match native-targets.json`);
  }
}

function assertSetEqual(
  actual: Set<string>,
  expected: Set<string>,
  label: string,
): void {
  const missing = [...expected].filter((value) => !actual.has(value));
  const extra = [...actual].filter((value) => !expected.has(value));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `${label} does not match native-targets.json. Missing: ${missing.join(", ") || "none"}. Extra: ${extra.join(", ") || "none"}.`,
    );
  }
}
