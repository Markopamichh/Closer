import { z } from "zod";
import { notFound } from "./errors";

const uuid = z.uuid();

/** A malformed id can never match a row, so it is reported as "not found", not 422. */
export function resourceId(value: string | undefined, resource: string): string {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw notFound(resource);
  return parsed.data;
}
