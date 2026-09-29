import type { ZodType } from "zod";

/** Browser-side call to the API (same origin via the /api rewrite); response is validated. */
export async function apiPost<T>(path: string, body: unknown, schema: ZodType<T>): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(errorMessage(data) ?? `Request failed (${res.status})`);
  return schema.parse(data);
}

function errorMessage(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  const { error } = data;
  if (typeof error === "object" && error !== null && "message" in error) {
    return typeof error.message === "string" ? error.message : undefined;
  }
  return undefined;
}
