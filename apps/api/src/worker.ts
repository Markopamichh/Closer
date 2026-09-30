import { createDb } from "@closer/db";
import { UnrecoverableError, Worker } from "bullmq";
import { loadEnv } from "./env";
import { processDocument } from "./ingestion/process-document";
import { createEmbedder } from "./lib/embedder";
import { createLogger } from "./lib/logger";
import { createStorage } from "./lib/storage";
import type { DocumentJob } from "./queue/documents";
import {
  createRedisConnection,
  DOCUMENT_QUEUE,
  documentJobSchema,
  INGESTION_ATTEMPTS,
} from "./queue/documents";

/**
 * Background worker process for document ingestion. Runs separately from the API so a
 * slow or heavy file never competes with HTTP requests, and scales on its own.
 */
const env = loadEnv();
const logger = createLogger(env).child({ process: "worker" });
const { db, close } = createDb(env.DATABASE_APP_URL, { max: 5 });
const connection = createRedisConnection(env.REDIS_URL);
const deps = { db, storage: createStorage(env), embedder: createEmbedder(env, logger), logger };

const worker = new Worker<DocumentJob>(
  DOCUMENT_QUEUE,
  async (job) => {
    const data = documentJobSchema.parse(job.data);
    const outcome = await processDocument(deps, {
      ...data,
      attempt: job.attemptsMade + 1,
      maxAttempts: job.opts.attempts ?? INGESTION_ATTEMPTS,
    });
    if (outcome.kind === "retry") throw outcome.error;
    // Tell BullMQ not to retry: the failure is already recorded on the document.
    if (outcome.kind === "failed") throw new UnrecoverableError(outcome.reason);
    return outcome;
  },
  { connection, prefix: env.QUEUE_PREFIX, concurrency: 4 },
);

worker.on("ready", () => {
  logger.info({ queue: DOCUMENT_QUEUE }, "worker ready");
});
worker.on("error", (err) => {
  logger.error({ err }, "worker error");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "worker shutting down");
  // Lets the in-flight job finish; unfinished ones are picked up again after restart.
  await worker.close();
  await Promise.allSettled([close(), connection.quit()]);
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
