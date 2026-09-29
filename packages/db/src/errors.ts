const FOREIGN_KEY_VIOLATION = "23503";

/** Drizzle wraps driver errors, so look through the `cause` chain for the Postgres code. */
function pgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; current instanceof Error && depth < 5; depth++) {
    if ("code" in current && typeof current.code === "string") return current.code;
    current = current.cause;
  }
  return undefined;
}

export const isForeignKeyViolation = (err: unknown) => pgErrorCode(err) === FOREIGN_KEY_VIOLATION;
