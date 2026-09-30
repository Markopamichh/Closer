import { runMigrations } from "@closer/db/migrate";
import { rm } from "node:fs/promises";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import postgres from "postgres";
import type { TestProject } from "vitest/node";

/** Creates `<db>_test` if needed, migrates it and wipes all data once per run. */
export default async function setup(project: TestProject) {
  const ownerUrl = project.config.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL missing from vitest env");

  const target = new URL(ownerUrl);
  const dbName = target.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to run tests against "${dbName}"`);

  const maintenance = new URL(ownerUrl);
  maintenance.pathname = "/postgres";
  const admin = postgres(maintenance.toString(), { max: 1, onnotice: () => undefined });
  const [exists] = await admin`select 1 from pg_database where datname = ${dbName}`;
  if (!exists) await admin.unsafe(`create database "${dbName}"`);
  await admin.end();

  await runMigrations(ownerUrl);

  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  await owner`truncate users, organizations, verifications cascade`;
  await owner.end();

  // Leftovers from a previous run: queued jobs (test prefix only) and uploaded files.
  const { REDIS_URL, QUEUE_PREFIX, LOCAL_STORAGE_DIR } = project.config.env;
  if (!REDIS_URL || !QUEUE_PREFIX?.endsWith("-test"))
    throw new Error("Refusing to clear a non-test queue");
  const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("document-ingestion", { connection, prefix: QUEUE_PREFIX });
  await queue.obliterate({ force: true });
  await queue.close();
  await connection.quit();
  if (LOCAL_STORAGE_DIR) await rm(LOCAL_STORAGE_DIR, { recursive: true, force: true });
}
