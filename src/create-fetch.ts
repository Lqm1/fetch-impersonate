import type { ImpersonateFetch, ImpersonateOptions } from "./options.js";
import { fetchWithDefaults } from "./fetch.js";
import { extractImpersonateOptions } from "./internal/normalize-options.js";

export function createFetch(defaults: ImpersonateOptions = {}): ImpersonateFetch {
  const capturedDefaults = extractImpersonateOptions(defaults);

  return (input, init) => fetchWithDefaults(input, init, capturedDefaults);
}
