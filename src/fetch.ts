import type {
  ImpersonateFetch,
  ImpersonateOptions,
  ImpersonateRequestInit,
} from "./options.js";
import { createResponse, responseMustNotHaveBody } from "./internal/create-response.js";
import { getAbortReason, mapNativeError } from "./internal/map-error.js";
import type {
  NativeBinding,
  NativeEvent,
  NativeHeadersEvent,
} from "./internal/native-types.js";
import {
  extractImpersonateOptions,
  extractStandardRequestInit,
  mergeImpersonateOptions,
} from "./internal/normalize-options.js";
import { normalizeRequest } from "./internal/normalize-request.js";
import { getNativeBinding } from "./native-loader.js";

export const fetch: ImpersonateFetch = (input, init) =>
  fetchWithDefaults(input, init, {});

export async function fetchWithDefaults(
  input: string | URL | Request,
  init: ImpersonateRequestInit | undefined,
  defaults: ImpersonateOptions,
): Promise<Response> {
  const options = mergeImpersonateOptions(
    defaults,
    extractImpersonateOptions(init),
  );
  const request = new Request(input, extractStandardRequestInit(init));
  const signal = request.signal;

  if (signal.aborted) {
    throw getAbortReason(signal);
  }

  const nativeRequest = await normalizeRequest(request, options);

  if (signal.aborted) {
    throw getAbortReason(signal);
  }

  return startNativeRequest(getNativeBinding(), nativeRequest, request, signal);
}

function startNativeRequest(
  binding: NativeBinding,
  nativeRequest: Awaited<ReturnType<typeof normalizeRequest>>,
  request: Request,
  signal: AbortSignal,
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    let transferId: bigint | undefined;
    let responseSettled = false;
    let nativeComplete = false;
    let terminal = false;
    let bodyQueueEmpty = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let discardBody = false;

    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
      pull() {
        drainBody();
      },
      cancel() {
        if (!terminal) {
          terminal = true;
          cleanup();
        }
        if (transferId !== undefined) {
          binding.cancelRequest(transferId);
        }
      },
    });

    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
    };

    const fail = (error: unknown): void => {
      if (terminal) {
        return;
      }
      terminal = true;
      cleanup();

      if (responseSettled) {
        streamController?.error(error);
      } else {
        reject(error);
      }
    };

    const drainBody = (): void => {
      if (transferId === undefined || terminal) {
        return;
      }

      while (discardBody || (streamController?.desiredSize ?? 0) > 0) {
        const chunk = binding.readBody(transferId);
        if (chunk === null) {
          bodyQueueEmpty = true;
          break;
        }
        bodyQueueEmpty = false;
        if (!discardBody) {
          streamController?.enqueue(chunk);
        }
      }

      if (nativeComplete && bodyQueueEmpty) {
        terminal = true;
        cleanup();
        streamController?.close();
      }
    };

    const onHeaders = (event: NativeHeadersEvent): void => {
      if (responseSettled || terminal) {
        fail(new Error("Native engine emitted response headers more than once"));
        return;
      }

      discardBody = responseMustNotHaveBody(request.method, event.status);
      responseSettled = true;
      resolve(createResponse(event, discardBody ? null : bodyStream));
      drainBody();
    };

    const onEvent = (event: NativeEvent): void => {
      if (transferId !== undefined && event.transferId !== transferId) {
        fail(new Error("Native engine emitted an event for another transfer"));
        return;
      }

      switch (event.type) {
        case "headers":
          onHeaders(event);
          break;
        case "body":
          bodyQueueEmpty = false;
          drainBody();
          break;
        case "complete":
          nativeComplete = true;
          drainBody();
          break;
        case "error":
          fail(mapNativeError(event.error, signal.aborted ? signal.reason : undefined));
          break;
      }
    };

    const onAbort = (): void => {
      if (transferId !== undefined) {
        binding.cancelRequest(transferId);
      }
      fail(getAbortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    try {
      transferId = binding.startRequest(nativeRequest, onEvent);
      drainBody();
    } catch (error) {
      fail(error);
      return;
    }

    if (signal.aborted) {
      onAbort();
    }
  });
}
