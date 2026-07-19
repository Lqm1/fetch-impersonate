import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const curlIncludeDirectory = join(
  root,
  "vendor",
  "include",
  "curl",
);
const headerNames = (await readdir(curlIncludeDirectory))
  .filter((name) => name.endsWith(".h"));
const curlHeader = (await Promise.all(headerNames.map(async (name) =>
  readFile(join(curlIncludeDirectory, name), "utf8"))))
  .join("\n");
const shimHeader = await readFile(
  join(root, "crates", "native", "c", "shim.h"),
  "utf8",
);
const bindings = await readFile(
  join(root, "crates", "native", "src", "ffi", "bindings.rs"),
  "utf8",
);

const committedOptions = new Map<string, number>();
for (const match of bindings.matchAll(
  /pub const (CURLOPT_[A-Z0-9_]+): CURLoption = (\d+);/g,
)) {
  committedOptions.set(match[1]!, Number(match[2]));
}
if (committedOptions.size === 0) throw new Error("No committed CURLOPT constants found");

const typeBases: Record<string, number> = {
  CURLOPTTYPE_LONG: 0,
  CURLOPTTYPE_OBJECTPOINT: 10_000,
  CURLOPTTYPE_STRINGPOINT: 10_000,
  CURLOPTTYPE_SLISTPOINT: 10_000,
  CURLOPTTYPE_CBPOINT: 10_000,
  CURLOPTTYPE_FUNCTIONPOINT: 20_000,
  CURLOPTTYPE_VALUES: 0,
  CURLOPTTYPE_OFF_T: 30_000,
  CURLOPTTYPE_BLOB: 40_000,
};
const headerOptions = new Map<string, number>();
for (const match of curlHeader.matchAll(
  /CURLOPT\((CURLOPT_[A-Z0-9_]+),\s*(CURLOPTTYPE_[A-Z]+),\s*(\d+)\)/g,
)) {
  const base = typeBases[match[2]!];
  if (base !== undefined) headerOptions.set(match[1]!, base + Number(match[3]));
}

const mismatches: string[] = [];
for (const [name, committed] of committedOptions) {
  const current = headerOptions.get(name);
  if (current === undefined) mismatches.push(`${name} is absent from curl.h`);
  else if (current !== committed) mismatches.push(`${name}: bindings=${committed}, curl.h=${current}`);
}

for (const functionName of bindings.matchAll(/pub fn ((?:curl|fi)_[a-z0-9_]+)\(/g)) {
  const name = functionName[1]!;
  if (!curlHeader.includes(`${name}(`) && !shimHeader.includes(`${name}(`)) {
    mismatches.push(`${name} is absent from curl.h and shim.h`);
  }
}

if (mismatches.length > 0) {
  throw new Error(`Committed FFI bindings differ from pinned headers:\n${mismatches.join("\n")}`);
}
console.log(
  `Committed FFI bindings match the vendored pinned headers (${committedOptions.size} options).`,
);
