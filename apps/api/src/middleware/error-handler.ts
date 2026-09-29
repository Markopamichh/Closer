import { APIError } from "better-auth/api";
import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { BaseVariables } from "../lib/context";
import { AppError } from "../lib/errors";

type ErrorBody = {
  error: { code: string; message: string; requestId: string; details?: unknown };
};

/**
 * Single place that turns exceptions into HTTP responses:
 * - AppError → its status and code.
 * - Better Auth APIError → its status, message passed through (already client-safe).
 * - Anything else → 500 with a generic message; the real error is only logged.
 * Every body carries the request id so a user report can be matched to the logs.
 */
export const errorHandler: ErrorHandler<{ Variables: BaseVariables }> = (err, c) => {
  const requestId = c.get("requestId");

  if (err instanceof AppError) {
    const body: ErrorBody = { error: { code: err.code, message: err.message, requestId } };
    if (err.details !== undefined) body.error.details = err.details;
    return c.json(body, err.status);
  }

  if (err instanceof APIError) {
    const body: ErrorBody = {
      error: {
        code: err.body?.code?.toLowerCase() ?? "auth_error",
        message: err.message,
        requestId,
      },
    };
    return c.json(body, err.statusCode as ContentfulStatusCode);
  }

  c.get("logger").error({ err }, "unhandled error");
  const body: ErrorBody = {
    error: { code: "internal_error", message: "Internal server error", requestId },
  };
  return c.json(body, 500);
};
