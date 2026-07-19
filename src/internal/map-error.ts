import type { NativeErrorInfo } from "./native-types.js";

export function mapNativeError(
  error: NativeErrorInfo,
  abortReason?: unknown,
): unknown {
  switch (error.kind) {
    case "invalidArgument":
      return new TypeError(error.message);
    case "cancelled":
      return abortReason === undefined ? createAbortError() : abortReason;
    case "curlEasy":
    case "curlMulti":
    case "fetch": {
      const cause = Object.assign(new Error(error.message), {
        ...(error.code === undefined ? {} : { code: error.code }),
        ...(error.curlCode === undefined ? {} : { curlCode: error.curlCode }),
      });
      return new TypeError("fetch failed", { cause });
    }
    case "internal":
      return new Error(error.message);
  }
}

export function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined ? createAbortError() : signal.reason;
}

function createAbortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}
