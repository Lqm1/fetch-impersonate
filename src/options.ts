export type ImpersonateTarget =
  | "chrome"
  | "chrome_android"
  | "edge"
  | "firefox"
  | "safari"
  | "safari_ios"
  | "safari_beta"
  | "safari_ios_beta"
  | "tor"
  | "edge99"
  | "edge101"
  | "chrome99"
  | "chrome100"
  | "chrome101"
  | "chrome104"
  | "chrome107"
  | "chrome110"
  | "chrome116"
  | "chrome119"
  | "chrome120"
  | "chrome123"
  | "chrome124"
  | "chrome131"
  | "chrome133a"
  | "chrome136"
  | "chrome142"
  | "chrome145"
  | "chrome146"
  | "chrome99_android"
  | "chrome131_android"
  | "safari153"
  | "safari155"
  | "safari170"
  | "safari172_ios"
  | "safari180"
  | "safari180_ios"
  | "safari184"
  | "safari184_ios"
  | "safari260"
  | "safari2601"
  | "safari260_ios"
  | "firefox133"
  | "firefox135"
  | "firefox144"
  | "firefox147"
  | "tor145"
  | (string & Record<never, never>);

export interface ExtraFingerprintOptions {
  tlsMinVersion?: "1.0" | "1.1" | "1.2" | "1.3";
  tlsGrease?: boolean;
  tlsPermuteExtensions?: boolean;
  tlsCertCompression?: "zlib" | "brotli";
  tlsSignatureAlgorithms?: readonly string[];
  tlsDelegatedCredential?: string;
  tlsRecordSizeLimit?: number;
  http2StreamWeight?: number;
  http2StreamExclusive?: boolean;
  http2NoPriority?: boolean;
  splitCookies?: boolean;
  formBoundary?: string;
  http3SigHashAlgs?: string;
  http3TlsExtensionOrder?: string;
}

export interface ImpersonateOptions {
  impersonate?: ImpersonateTarget;
  defaultHeaders?: boolean;
  proxy?: string;
  timeout?: number;
  connectTimeout?: number;
  httpVersion?: "auto" | "1.1" | "2" | "3";
  ja3?: string;
  akamai?: string;
  extraFp?: ExtraFingerprintOptions;
}

export interface ImpersonateRequestInit
  extends RequestInit,
    ImpersonateOptions {}

export type ImpersonateFetch = (
  input: string | URL | Request,
  init?: ImpersonateRequestInit,
) => Promise<Response>;
