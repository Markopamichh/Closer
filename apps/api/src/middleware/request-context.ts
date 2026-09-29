import { createMiddleware } from "hono/factory";
import type { BaseVariables } from "../lib/context";
import type { Logger } from "../lib/logger";

/**
 * Must run after hono's `requestId()`. Attaches a request-scoped child logger and emits
 * one structured line per request once the response is ready.
 */
export const requestContext = (logger: Logger) =>
  createMiddleware<{ Variables: BaseVariables }>(async (c, next) => {
    const start = performance.now();
    c.set("logger", logger.child({ requestId: c.get("requestId") }));

    await next();

    // Read the logger again: auth middleware may have enriched it with the user id.
    const status = c.res.status;
    const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
    c.get("logger")[level](
      {
        method: c.req.method,
        path: c.req.path,
        status,
        durationMs: Math.round(performance.now() - start),
      },
      "request completed",
    );
  });
