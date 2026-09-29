import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 10, prepare: false });
  const db = drizzle(client, { schema, casing: "snake_case" });
  return { db, close: () => client.end() };
}

export type Db = ReturnType<typeof createDb>["db"];
/** A transaction handle; same query API as Db. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Cheap connectivity check for health probes. */
export async function pingDb(db: Db): Promise<void> {
  await db.execute(sql`select 1`);
}
