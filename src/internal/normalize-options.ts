import type { ImpersonateOptions, ImpersonateRequestInit } from "../options.js";

const impersonateOptionKeys = [
  "impersonate",
  "defaultHeaders",
  "proxy",
  "timeout",
  "connectTimeout",
  "httpVersion",
  "ja3",
  "akamai",
  "extraFp",
] as const satisfies readonly (keyof ImpersonateOptions)[];

const standardRequestInitKeys = [
  "body",
  "cache",
  "credentials",
  "headers",
  "integrity",
  "keepalive",
  "method",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "window",
  "duplex",
] as const satisfies readonly (keyof ImpersonateRequestInit)[];

export function extractImpersonateOptions(
  init: ImpersonateRequestInit | ImpersonateOptions | undefined,
): ImpersonateOptions {
  if (init === undefined) {
    return {};
  }

  return validateImpersonateOptions(pickDefinedKeys(init, impersonateOptionKeys));
}

export function extractStandardRequestInit(init: ImpersonateRequestInit | undefined): RequestInit {
  if (init === undefined) {
    return {};
  }

  return pickDefinedKeys(init, standardRequestInitKeys);
}

export function mergeImpersonateOptions(
  defaults: ImpersonateOptions,
  overrides: ImpersonateOptions,
): ImpersonateOptions {
  return validateImpersonateOptions({ ...defaults, ...overrides });
}

function pickDefinedKeys<T extends object, K extends keyof T>(
  source: T,
  keys: readonly K[],
): { [P in K]?: T[P] } {
  const picked: { [P in K]?: T[P] } = {};

  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) {
      picked[key] = value;
    }
  }

  return picked;
}

function validateImpersonateOptions(options: ImpersonateOptions): ImpersonateOptions {
  validateOptionalString(options.impersonate, "impersonate");
  validateOptionalBoolean(options.defaultHeaders, "defaultHeaders");
  validateOptionalString(options.proxy, "proxy");
  validateOptionalTimeout(options.timeout, "timeout");
  validateOptionalTimeout(options.connectTimeout, "connectTimeout");
  validateOptionalString(options.ja3, "ja3");
  validateOptionalString(options.akamai, "akamai");

  if (
    options.httpVersion !== undefined &&
    !["auto", "1.1", "2", "3"].includes(options.httpVersion)
  ) {
    throw new TypeError('httpVersion must be one of "auto", "1.1", "2", or "3"');
  }

  if (
    options.extraFp !== undefined &&
    (typeof options.extraFp !== "object" || options.extraFp === null)
  ) {
    throw new TypeError("extraFp must be an object");
  }

  return { ...options };
}

function validateOptionalString(value: unknown, name: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${name} must be a string`);
  }
}

function validateOptionalBoolean(
  value: unknown,
  name: string,
): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean`);
  }
}

function validateOptionalTimeout(value: unknown, name: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    throw new TypeError(`${name} must be a finite, non-negative number`);
  }
}
