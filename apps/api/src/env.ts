import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** Runtime connection as the non-bypass role `closer_app` (RLS applies). */
    DATABASE_APP_URL: z.url(),
    REDIS_URL: z.url().default("redis://localhost:6380"),
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Public origin where /api/auth is reachable (the web app, which proxies /api). */
    BETTER_AUTH_URL: z.url(),
    WEB_ORIGIN: z.url(),

    /** Without a key, document ingestion uses the offline fake embedder (dev only). */
    VOYAGE_API_KEY: z.string().min(1).optional(),
    EMBEDDING_MODEL: z.string().min(1).default("voyage-4"),

    STORAGE_DRIVER: z.enum(["local", "supabase"]).default("local"),
    LOCAL_STORAGE_DIR: z.string().min(1).default(".data/uploads"),
    SUPABASE_URL: z.url().optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    STORAGE_BUCKET: z.string().min(1).default("documents"),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "supabase") {
      for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const) {
        if (!env[key])
          ctx.addIssue({
            code: "custom",
            path: [key],
            message: "required when STORAGE_DRIVER=supabase",
          });
      }
    }
    if (env.NODE_ENV === "production") {
      if (!env.VOYAGE_API_KEY) {
        ctx.addIssue({
          code: "custom",
          path: ["VOYAGE_API_KEY"],
          message: "required in production",
        });
      }
      if (env.STORAGE_DRIVER !== "supabase") {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_DRIVER"],
          message: "must be supabase in production",
        });
      }
    }
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
