import { createDb } from "@closer/db";
import { serve } from "@hono/node-server";
import { Redis } from "ioredis";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createEmbedder } from "./lib/embedder";
import { createLogger } from "./lib/logger";
import { createRedisRateLimiter } from "./lib/rate-limit";
import { createStorage } from "./lib/storage";
import { createDocumentQueue } from "./queue/documents";

const env = loadEnv();
const logger = createLogger(env);
const { db, close } = createDb(env.DATABASE_APP_URL);
const auth = createAuth({ db, env, logger });
const documents = createDocumentQueue(env.REDIS_URL, env.QUEUE_PREFIX);
// Default retry settings (unlike BullMQ's connection), so a Redis outage fails fast and the
// limiter can fail open instead of hanging the request.
const redis = new Redis(env.REDIS_URL);
const SEARCHES_PER_MINUTE = 30;
const app = createApp({
  db,
  auth,
  logger,
  storage: createStorage(env),
  documentQueue: documents.queue,
  embedder: createEmbedder(env, logger),
  searchLimiter: createRedisRateLimiter(redis, {
    prefix: env.QUEUE_PREFIX,
    limit: SEARCHES_PER_MINUTE,
    windowSeconds: 60,
  }),
});

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});

// Drain in-flight requests and close the pool on deploys/restarts.
function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void Promise.allSettled([close(), documents.close(), redis.quit()]).finally(() =>
      process.exit(0),
    );
  });
}
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
