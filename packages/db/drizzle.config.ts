import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required (owner connection, used for migrations)");

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: { url },
});
