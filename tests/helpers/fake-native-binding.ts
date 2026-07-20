import type {
  NativeBinding,
  NativeErrorInfo,
  NativeEventListener,
  NativeRequest,
  NativeVersionInfo,
} from "../../src/internal/native-types.js";

export interface FakeResponse {
  status?: number;
  statusText?: string;
  headers?: Array<[string, string]>;
  body?: Uint8Array[];
  url?: string;
  redirected?: boolean;
  error?: NativeErrorInfo;
  complete?: boolean;
}

export class FakeNativeBinding implements NativeBinding {
  readonly requests: NativeRequest[] = [];
  readonly cancelled: bigint[] = [];

  #nextTransferId = 1n;
  #chunks = new Map<bigint, Uint8Array[]>();
  #responseFactory: (request: NativeRequest) => FakeResponse;

  constructor(responseFactory: (request: NativeRequest) => FakeResponse = () => ({})) {
    this.#responseFactory = responseFactory;
  }

  startRequest(request: NativeRequest, listener: NativeEventListener): bigint {
    const transferId = this.#nextTransferId++;
    const response = this.#responseFactory(request);
    this.requests.push(request);
    this.#chunks.set(transferId, [...(response.body ?? [])]);

    queueMicrotask(() => {
      if (response.error !== undefined) {
        listener({ type: "error", transferId, error: response.error });
        return;
      }

      listener({
        type: "headers",
        transferId,
        status: response.status ?? 200,
        statusText: response.statusText ?? "OK",
        headers: response.headers ?? [],
        url: response.url ?? request.url,
        redirected: response.redirected ?? false,
      });

      if ((response.body?.length ?? 0) > 0) {
        listener({ type: "body", transferId });
      }

      if (response.complete !== false) {
        listener({ type: "complete", transferId });
      }
    });

    return transferId;
  }

  readBody(transferId: bigint): Uint8Array | null {
    return this.#chunks.get(transferId)?.shift() ?? null;
  }

  cancelRequest(transferId: bigint): void {
    this.cancelled.push(transferId);
  }

  version(): NativeVersionInfo {
    return {
      addon: "test",
      curl: "test",
      curlImpersonate: "test",
    };
  }
}
