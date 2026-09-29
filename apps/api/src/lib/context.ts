import type { Logger } from "./logger";

/** Variables available on every request (set by the request-context middleware). */
export type BaseVariables = {
  requestId: string;
  logger: Logger;
};
