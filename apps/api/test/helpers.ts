import type { EmbeddingProvider } from "@closer/ai";
import { createFakeEmbedder } from "@closer/ai";
import type { Db } from "@closer/db";
import { createDb } from "@closer/db";
import { Redis } from "ioredis";
import postgres from "postgres";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { loadEnv } from "../src/env";
import type { Logger } from "../src/lib/logger";
import { createLogger } from "../src/lib/logger";
import type { RateLimiter } from "../src/lib/rate-limit";
import { createRedisRateLimiter } from "../src/lib/rate-limit";
import type { FileStorage } from "../src/lib/storage";
import { createStorage } from "../src/lib/storage";
import type { DocumentQueue } from "../src/queue/documents";
import { createDocumentQueue } from "../src/queue/documents";

export const WEB_ORIGIN = "http://localhost:3000";

export type TestContext = {
  app: ReturnType<typeof createApp>;
  /** Runtime connection as closer_app (RLS enforced) — what the API uses. */
  db: Db;
  /** Owner connection (bypasses RLS) — only for seeding and asserting ground truth. */
  sql: postgres.Sql;
  storage: FileStorage;
  documentQueue: DocumentQueue;
  embedder: EmbeddingProvider;
  logger: Logger;
  close: () => Promise<void>;
};

export function createTestContext(
  overrides: { embedder?: EmbeddingProvider; searchLimiter?: RateLimiter } = {},
): TestContext {
  const env = loadEnv();
  const logger = createLogger(env);
  const { db, close: closeDb } = createDb(env.DATABASE_APP_URL, { max: 5 });
  const auth = createAuth({ db, env, logger });
  const storage = createStorage(env);
  const documents = createDocumentQueue(env.REDIS_URL, env.QUEUE_PREFIX);
  const documentQueue = documents.queue;
  const embedder = overrides.embedder ?? createFakeEmbedder();
  const redis = new Redis(env.REDIS_URL);
  // A unique prefix per context keeps counters from leaking between test files.
  const searchLimiter =
    overrides.searchLimiter ??
    createRedisRateLimiter(redis, {
      prefix: `${env.QUEUE_PREFIX}:${crypto.randomUUID()}`,
      limit: 1000,
      windowSeconds: 60,
    });
  const app = createApp({ db, auth, logger, storage, documentQueue, embedder, searchLimiter });
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL missing");
  const sql = postgres(ownerUrl, { max: 2, onnotice: () => undefined });

  return {
    app,
    db,
    sql,
    storage,
    documentQueue,
    embedder,
    logger,
    close: async () => {
      await Promise.all([closeDb(), sql.end(), documents.close(), redis.quit()]);
    },
  };
}

let seq = 0;
/** Unique per test run so files never collide on the unique email constraint. */
export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}-${(seq++).toString(36)}@closer.test`;

export type Client = {
  userId: string;
  email: string;
  request: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;
  /** Multipart upload; the boundary header is set by the runtime from the FormData. */
  upload: (path: string, form: FormData) => Promise<Response>;
};

/** A signed-in API client: signs up through Better Auth and replays the session cookie. */
export async function signUp(app: TestContext["app"], label: string): Promise<Client> {
  const email = uniqueEmail(label);
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({ name: label, email, password: "correct-horse-battery" }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = (await res.json()) as { user: { id: string } };

  return {
    userId: user.id,
    email,
    request: async (path, init = {}) =>
      app.request(path, {
        method: init.method ?? "GET",
        headers: { cookie, origin: WEB_ORIGIN, "content-type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
    upload: async (path, form) =>
      app.request(path, { method: "POST", headers: { cookie, origin: WEB_ORIGIN }, body: form }),
  };
}

/** A FormData with a single CSV file field, as a browser would send it. */
export function csvForm(content: string, field = "file"): FormData {
  const form = new FormData();
  form.append(field, new File([content], "inventory.csv", { type: "text/csv" }));
  return form;
}

/** Unauthenticated request (no cookie). */
export const anonymous = async (
  app: TestContext["app"],
  path: string,
  method = "GET",
  body?: unknown,
) =>
  app.request(path, {
    method,
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
