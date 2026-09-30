import { and, desc, eq, sql } from "drizzle-orm";
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

export type ChunkSearchHit = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  /** Cosine similarity in [-1, 1]; higher is more relevant. */
  score: number;
};

export type ChunkSearch = {
  embedding: number[];
  /** Only chunks embedded with this model are comparable to the query vector. */
  embeddingModel: string;
  limit: number;
};

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
     * Nearest chunks by cosine distance, restricted to this org's ready documents.
     *
     * An HNSW index returns the k nearest vectors of the whole table and only then
     * applies WHERE filters; if those k belong to other tenants this org gets nothing.
     * pgvector 0.8's iterative scan keeps walking the graph until enough rows pass the
     * filters. `relaxed_order` is faster but may return slightly out-of-order rows, so the
     * outer query re-sorts the candidates exactly.
     */
    searchChunks: async ({
      embedding,
      embeddingModel,
      limit,
    }: ChunkSearch): Promise<ChunkSearchHit[]> => {
      await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
      await tx.execute(sql`set local hnsw.ef_search = 100`);
      const vector = JSON.stringify(embedding);
      const rows = await tx.execute<{
        chunk_id: string;
        document_id: string;
        document_title: string;
        chunk_index: number;
        content: string;
        distance: number;
      }>(sql`
        select * from (
          select c.id as chunk_id, c.document_id, d.title as document_title, c.chunk_index,
                 c.content, c.embedding <=> ${vector}::vector as distance
          from ${chunks} c
          join ${documents} d on d.id = c.document_id and d.org_id = c.org_id
          where c.org_id = ${orgId}
            and d.status = 'ready'
            and c.metadata->>'embeddingModel' = ${embeddingModel}
          order by c.embedding <=> ${vector}::vector
          limit ${limit}
        ) candidates
        order by distance
      `);
      return rows.map((r) => ({
        chunkId: r.chunk_id,
        documentId: r.document_id,
        documentTitle: r.document_title,
        chunkIndex: r.chunk_index,
        content: r.content,
        score: 1 - r.distance,
      }));
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
