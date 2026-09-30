import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "../client";
import { chunks, documents } from "../schema";

type Document = typeof documents.$inferSelect;
export type NewDocument = Pick<
  typeof documents.$inferInsert,
  "id" | "title" | "sourceType" | "mimeType" | "sizeBytes" | "storagePath"
>;
export type NewChunk = {
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[];
  metadata: Record<string, unknown>;
};
type StatusUpdate = Partial<Pick<Document, "status" | "error" | "chunkCount" | "processedAt">>;

const CHUNK_INSERT_BATCH = 200;

export function documentsRepo(tx: Tx, orgId: string) {
  const scope = (id: string) => and(eq(documents.orgId, orgId), eq(documents.id, id));

  return {
    list: () =>
      tx
        .select()
        .from(documents)
        .where(eq(documents.orgId, orgId))
        .orderBy(desc(documents.createdAt), desc(documents.id)),

    get: async (id: string) => {
      const [row] = await tx.select().from(documents).where(scope(id));
      return row ?? null;
    },

    create: async (input: NewDocument) => {
      const [row] = await tx
        .insert(documents)
        .values({ ...input, orgId })
        .returning();
      if (!row) throw new Error("documents.create: insert returned no row");
      return row;
    },

    update: async (id: string, patch: StatusUpdate) => {
      const [row] = await tx.update(documents).set(patch).where(scope(id)).returning();
      return row ?? null;
    },

    /** Deletes the document (chunks cascade) and returns it so storage can be cleaned up. */
    delete: async (id: string) => {
      const [row] = await tx.delete(documents).where(scope(id)).returning();
      return row ?? null;
    },

    /**
     * Replaces all chunks of a document. Idempotent, so a retried ingestion job can
     * never leave duplicates behind. Must run in the same transaction as the status update.
     */
    replaceChunks: async (documentId: string, rows: NewChunk[]) => {
      await tx
        .delete(chunks)
        .where(and(eq(chunks.orgId, orgId), eq(chunks.documentId, documentId)));
      for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
        await tx
          .insert(chunks)
          .values(
            rows.slice(i, i + CHUNK_INSERT_BATCH).map((row) => ({ ...row, documentId, orgId })),
          );
      }
    },
  };
}
