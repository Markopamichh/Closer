import { runMigrations } from "@closer/db/migrate";
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
}
