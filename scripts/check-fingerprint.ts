import { createHash } from "node:crypto";

import { fetch } from "../src/index.js";

const endpoint = process.env.FETCH_IMPERSONATE_FINGERPRINT_URL
  ?? "https://tls.browserleaks.com/json";
const ja3 = [
  "771",
  "4865-4866-4867-49195-49196-52393-49199-49200-52392-49171-49172-156-157-47-53",
  "0-23-65281-10-11-35-16-5-13-51-45-43-21",
  "29-23-24",
  "0",
].join(",");

const response = await fetch(endpoint, { ja3, timeout: 15_000 });
if (!response.ok) {
  throw new Error(`fingerprint endpoint returned HTTP ${response.status}`);
}

const payload = await response.json() as Record<string, unknown>;
const reportedHash = payload.ja3_hash;
if (typeof reportedHash !== "string") {
  throw new TypeError("fingerprint endpoint response has no ja3_hash string");
}

const expectedHash = createHash("md5").update(ja3).digest("hex");
if (reportedHash !== expectedHash) {
  throw new Error(
    `JA3 mismatch: expected ${expectedHash}, received ${reportedHash}; reported text: ${String(payload.ja3_text)}`,
  );
}

console.log(JSON.stringify({
  endpoint,
  httpVersion: payload.http_version,
  ja3Hash: reportedHash,
}));
