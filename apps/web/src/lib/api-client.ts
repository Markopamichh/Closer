import type { ZodType } from "zod";

/** A non-2xx API response; `code` is the stable machine-readable error code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

/** Browser-side call to the API (same origin via the /api rewrite); response is validated. */
export async function apiSend<T>(
  method: "POST" | "PATCH",
  path: string,
  body: unknown,
  schema: ZodType<T>,
): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = errorBody(data);
    throw new ApiError(res.status, error?.code, error?.message ?? `Request failed (${res.status})`);
  }
  return schema.parse(data);
}

export const apiPost = <T>(path: string, body: unknown, schema: ZodType<T>) =>
  apiSend("POST", path, body, schema);

function errorBody(data: unknown): { code?: string; message?: string } | undefined {
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  const { error } = data;
  if (typeof error !== "object" || error === null) return undefined;
  return {
    code: "code" in error && typeof error.code === "string" ? error.code : undefined,
    message: "message" in error && typeof error.message === "string" ? error.message : undefined,
  };
}

/**
 * Multipart upload. `bodyStatuses` are non-2xx statuses whose body is still a valid
 * result (e.g. a CSV report with row errors comes back as 422).
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  schema: ZodType<T>,
  bodyStatuses: readonly number[] = [],
): Promise<T> {
  const res = await fetch(path, { method: "POST", body: form });
  const data: unknown = await res.json().catch(() => null);
  if (res.ok || bodyStatuses.includes(res.status)) {
    const parsed = schema.safeParse(data);
    if (parsed.success) return parsed.data;
  }
  const error = errorBody(data);
  throw new ApiError(res.status, error?.code, error?.message ?? `Request failed (${res.status})`);
}

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE" });
  if (res.ok) return;
  const error = errorBody(await res.json().catch(() => null));
  throw new ApiError(res.status, error?.code, error?.message ?? `Request failed (${res.status})`);
}

export async function apiGet<T>(path: string, schema: ZodType<T>): Promise<T> {
  const res = await fetch(path);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = errorBody(data);
    throw new ApiError(res.status, error?.code, error?.message ?? `Request failed (${res.status})`);
  }
  return schema.parse(data);
}
