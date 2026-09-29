import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Applies all pending migrations. `url` must be an owner connection (not closer_app). */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end();
  }
}
