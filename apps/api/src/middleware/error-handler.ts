import { APIError } from "better-auth/api";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

/**
 * Single place that turns exceptions into HTTP responses:
 * - AppError → its status and code.
 * - Better Auth APIError → its status, message passed through (already client-safe).
 * - Anything else → 500 with a generic message; the real error is only logged.
 */
export const createErrorHandler =
  (logger: Logger): ErrorHandler =>
  (err, c) => {
    if (err instanceof AppError) {
      const body: ErrorBody = { error: { code: err.code, message: err.message } };
      if (err.details !== undefined) body.error.details = err.details;
      return c.json(body, err.status);
    }

    if (err instanceof APIError) {
      const status = err.statusCode as ContentfulStatusCode;
      const body: ErrorBody = {
        error: { code: err.body?.code?.toLowerCase() ?? "auth_error", message: err.message },
      };
      return c.json(body, status);
    }

    logger.error({ err }, "unhandled error");
    const body: ErrorBody = { error: { code: "internal_error", message: "Internal server error" } };
    return c.json(body, 500);
  };
