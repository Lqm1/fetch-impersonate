import { createFetch } from "./create-fetch.js";
import { fetch } from "./fetch.js";

export default fetch;
export { createFetch, fetch };
export type {
  ExtraFingerprintOptions,
  ImpersonateFetch,
  ImpersonateOptions,
  ImpersonateRequestInit,
  ImpersonateTarget,
} from "./options.js";
