# Vendored curl headers

The headers in `curl/` are copied unchanged from the
`libcurl-impersonate-v2.0.0rc4.x86_64-linux-gnu.tar.gz` artifact pinned in
`../curl-impersonate.lock.json`. All official artifacts in that lock contain
the same header bytes.

They are committed so FFI generation and drift checks never run against a
user-installed curl SDK. Runtime builds still link the exact, SHA-256-verified
artifact selected by `native-targets.json`.
