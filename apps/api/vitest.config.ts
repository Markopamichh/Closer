import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

const rootEnv = new URL("../../.env", import.meta.url);
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

/** Tests never touch the dev database: same server, `<name>_test` database. */
function toTestDatabase(url: string | undefined, name: string): string {
  if (!url) throw new Error(`${name} is required to run the tests`);
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith("_test")) parsed.pathname = `${parsed.pathname}_test`;
  return parsed.toString();
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // All files share one database; running them in parallel would make them race.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6380",
      QUEUE_PREFIX: "closer-test",
      STORAGE_DRIVER: "local",
      LOCAL_STORAGE_DIR: ".data/test-uploads",
      VOYAGE_API_KEY: "",
      DATABASE_URL: toTestDatabase(process.env.DATABASE_URL, "DATABASE_URL"),
      DATABASE_APP_URL: toTestDatabase(process.env.DATABASE_APP_URL, "DATABASE_APP_URL"),
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-000",
      BETTER_AUTH_URL: "http://localhost:3000",
      WEB_ORIGIN: "http://localhost:3000",
    },
  },
});
