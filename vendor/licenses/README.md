# Native artifact notices

`curl-impersonate-LICENSE` is the license shipped by the upstream source at
commit `99616c159d5a5efb8ee88335536106523fe455ce`, which is the exact commit
recorded in `../curl-impersonate.lock.json`.

The upstream binary version string records its bundled protocol and
compression dependencies (BoringSSL, zlib, Brotli, Zstandard, nghttp2,
ngtcp2, and nghttp3). Release engineering must retain the complete notices
from the pinned upstream release when upstream begins shipping an expanded
notice bundle; `scripts/prepare-native.ts` deliberately never substitutes
system copies of these libraries.
