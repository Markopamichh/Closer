export type ErrorCode =
  | "bad_request"
  | "validation_error"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "internal_error"
  | "service_unavailable";

const STATUS: Record<ErrorCode, 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 503> = {
  bad_request: 400,
  validation_error: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

/** Expected, client-facing errors. Anything else is treated as a 500 by the error handler. */
export class AppError extends Error {
  readonly status: (typeof STATUS)[ErrorCode];

  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

export const unauthorized = () => new AppError("unauthorized", "Authentication required");
export const forbidden = () =>
  new AppError("forbidden", "You do not have permission to perform this action");
export const notFound = (resource = "Resource") =>
  new AppError("not_found", `${resource} not found`);
