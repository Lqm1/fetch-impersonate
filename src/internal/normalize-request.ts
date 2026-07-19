import type { ImpersonateOptions } from "../options.js";
import type { NativeOptions, NativeRequest } from "./native-types.js";

export async function normalizeRequest(
  request: Request,
  options: ImpersonateOptions,
): Promise<NativeRequest> {
  const body = request.body === null ? null : new Uint8Array(await request.arrayBuffer());

  return {
    url: request.url,
    method: request.method,
    headers: Array.from(request.headers.entries()),
    ...(body === null ? {} : { body }),
    redirect: request.redirect,
    options: toNativeOptions(options),
  };
}

function toNativeOptions(options: ImpersonateOptions): NativeOptions {
  const nativeOptions: NativeOptions = {};

  copyDefined(nativeOptions, options, "impersonate");
  copyDefined(nativeOptions, options, "defaultHeaders");
  copyDefined(nativeOptions, options, "proxy");
  copyDefined(nativeOptions, options, "timeout");
  copyDefined(nativeOptions, options, "connectTimeout");
  copyDefined(nativeOptions, options, "httpVersion");
  copyDefined(nativeOptions, options, "ja3");
  copyDefined(nativeOptions, options, "akamai");

  if (options.extraFp !== undefined) {
    nativeOptions.extraFp = JSON.stringify(options.extraFp);
  }

  return nativeOptions;
}

function copyDefined<
  Target extends object,
  Source extends object,
  Key extends keyof Target & keyof Source,
>(target: Target, source: Source, key: Key): void {
  const value = source[key];
  if (value !== undefined) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
}
