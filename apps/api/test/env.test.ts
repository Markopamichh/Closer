import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/env";

const base = {
  DATABASE_APP_URL: "postgres://closer_app:x@localhost:5433/closer",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  WEB_ORIGIN: "http://localhost:3000",
};

describe("environment validation", () => {
  it("applies safe local defaults", () => {
    const env = loadEnv(base);
    expect(env).toMatchObject({
      STORAGE_DRIVER: "local",
      EMBEDDING_MODEL: "voyage-4",
      API_PORT: 4000,
    });
  });

  it("requires Supabase credentials when the supabase storage driver is selected", () => {
    expect(() => loadEnv({ ...base, STORAGE_DRIVER: "supabase" })).toThrow(
      /SUPABASE_URL[\s\S]*SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("refuses to boot in production without a real embedder and durable storage", () => {
    expect(() => loadEnv({ ...base, NODE_ENV: "production" })).toThrow(
      /VOYAGE_API_KEY[\s\S]*STORAGE_DRIVER/,
    );
  });

  it("rejects a short auth secret", () => {
    expect(() => loadEnv({ ...base, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
  });
});
