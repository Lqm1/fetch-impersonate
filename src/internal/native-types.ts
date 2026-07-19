export interface NativeOptions {
  impersonate?: string;
  defaultHeaders?: boolean;
  proxy?: string;
  timeout?: number;
  connectTimeout?: number;
  httpVersion?: "auto" | "1.1" | "2" | "3";
  ja3?: string;
  akamai?: string;
  extraFp?: string;
}

export interface NativeRequest {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: Uint8Array;
  redirect: RequestRedirect;
  options: NativeOptions;
}

export interface NativeHeadersEvent {
  type: "headers";
  transferId: bigint;
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  url: string;
  redirected: boolean;
}

export interface NativeBodyEvent {
  type: "body";
  transferId: bigint;
}

export interface NativeCompleteEvent {
  type: "complete";
  transferId: bigint;
}

export interface NativeErrorInfo {
  kind:
    | "invalidArgument"
    | "curlEasy"
    | "curlMulti"
    | "fetch"
    | "cancelled"
    | "internal";
  message: string;
  code?: string;
  curlCode?: number;
}

export interface NativeErrorEvent {
  type: "error";
  transferId: bigint;
  error: NativeErrorInfo;
}

export type NativeEvent =
  | NativeHeadersEvent
  | NativeBodyEvent
  | NativeCompleteEvent
  | NativeErrorEvent;

export type NativeEventListener = (event: NativeEvent) => void;

export interface NativeVersionInfo {
  addon: string;
  curl: string;
  curlImpersonate: string;
}

export interface NativeBinding {
  startRequest(request: NativeRequest, listener: NativeEventListener): bigint;
  readBody(transferId: bigint): Uint8Array | null;
  cancelRequest(transferId: bigint): void;
  version(): NativeVersionInfo;
}
