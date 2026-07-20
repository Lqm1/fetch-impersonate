import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const includeDirectory = join(root, "vendor", "include");
const output = process.argv.includes("--write")
  ? join(root, "crates", "native", "src", "ffi", "bindings.rs")
  : join(root, ".artifacts", "bindings.rs");
await mkdir(dirname(output), { recursive: true });

const result = spawnSync(
  "bindgen",
  [
    join(root, "crates", "native", "c", "shim.h"),
    "--allowlist-type",
    "^CURL.*$",
    "--allowlist-var",
    "^(CURL|CURLE|CURLM|CURLOPT|CURLINFO).*$",
    "--allowlist-function",
    "^(curl_|fi_).*$",
    "--opaque-type",
    "^CURLM?$",
    "--no-layout-tests",
    "--output",
    output,
    "--",
    `-I${includeDirectory}`,
  ],
  { encoding: "utf8" },
);
if (result.status !== 0) {
  throw new Error(
    `bindgen failed. Install the Rust bindgen-cli development tool first.\n${result.stderr || result.stdout}`,
  );
}
console.log(
  process.argv.includes("--write")
    ? "Updated committed bindings from the vendored headers; review the generated diff."
    : `Generated bindings for inspection at ${output}.`,
);
