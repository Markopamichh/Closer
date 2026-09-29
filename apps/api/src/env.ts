import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  /** Runtime connection as the non-bypass role `closer_app` (RLS applies). */
  DATABASE_APP_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Public origin where /api/auth is reachable (the web app, which proxies /api). */
  BETTER_AUTH_URL: z.url(),
  WEB_ORIGIN: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // Fail fast at boot with a readable list instead of a runtime crash later.
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment variables:\n${issues.join("\n")}`);
  }
  return parsed.data;
}
