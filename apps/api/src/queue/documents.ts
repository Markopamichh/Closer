import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

export const DOCUMENT_QUEUE = "document-ingestion";
export const INGESTION_ATTEMPTS = 3;

/**
 * The payload carries ids only. The worker re-reads everything through withTenant, so a
 * tampered or stale payload can't point it at another tenant's data.
 */
export const documentJobSchema = z.object({ orgId: z.uuid(), documentId: z.uuid() });
export type DocumentJob = z.infer<typeof documentJobSchema>;

/**
 * A dedicated Redis client. BullMQ needs `maxRetriesPerRequest: null` for the blocking
 * commands workers use, and it never closes clients it receives, so callers must `quit()`.
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: null });
}

export type DocumentQueue = Queue<DocumentJob>;

export function createDocumentQueue(redisUrl: string, prefix: string) {
  const connection = createRedisConnection(redisUrl);
  const queue: DocumentQueue = new Queue<DocumentJob>(DOCUMENT_QUEUE, {
    connection,
    prefix,
    defaultJobOptions: {
      attempts: INGESTION_ATTEMPTS,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 60 * 60, count: 1_000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    },
  });
  return {
    queue,
    close: async () => {
      await queue.close();
      await connection.quit();
    },
  };
}

export async function enqueueDocument(queue: DocumentQueue, job: DocumentJob): Promise<void> {
  await queue.add("ingest", documentJobSchema.parse(job));
}
