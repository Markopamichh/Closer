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
  /** Tenants up to this many chunks get exact search. Overridable for tests and tuning. */
  exactSearchMaxChunks?: number;
};

/**
 * Exact search costs ~3 ms per 1k vectors (measured locally), so up to 10k chunks it
 * stays well under the query-embedding latency while guaranteeing full recall.
 */
export const EXACT_SEARCH_MAX_CHUNKS = 10_000;

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
     * Nearest chunks by cosine distance within this org. No status filter on purpose:
     * chunks exist only for ready documents, or for ones being re-processed (their previous
     * index stays searchable until replaced); a failed job deletes them with the status.
     *
     * HNSW is approximate: it can miss rows whose graph nodes are poorly connected (e.g.
     * crowded out by near-duplicate chunks of another tenant). Small tenants therefore get
     * an exact scan; the materialized CTE keeps the planner from using the HNSW index.
     *
     * Large tenants use HNSW. It returns the k nearest vectors of the whole table before
     * applying WHERE filters, so pgvector 0.8's iterative scan keeps walking the graph until
     * enough rows pass them. `relaxed_order` may return slightly out-of-order rows, so the
     * outer query re-sorts the candidates exactly.
     */
    searchChunks: async ({
      embedding,
      embeddingModel,
      limit,
      exactSearchMaxChunks = EXACT_SEARCH_MAX_CHUNKS,
    }: ChunkSearch): Promise<ChunkSearchHit[]> => {
      const vector = JSON.stringify(embedding);
      const candidates = sql`
        select c.id as chunk_id, c.document_id, d.title as document_title, c.chunk_index,
               c.content, c.embedding <=> ${vector}::vector as distance
        from ${chunks} c
        join ${documents} d on d.id = c.document_id and d.org_id = c.org_id
        where c.org_id = ${orgId}
          and c.metadata->>'embeddingModel' = ${embeddingModel}`;

      const [size] = await tx.execute<{ chunks: number }>(sql`
        select coalesce(sum(chunk_count), 0)::int as chunks
        from ${documents} where org_id = ${orgId}`);
      const exact = (size?.chunks ?? 0) <= exactSearchMaxChunks;

      if (!exact) {
        await tx.execute(sql`set local hnsw.iterative_scan = relaxed_order`);
        await tx.execute(sql`set local hnsw.ef_search = 100`);
      }
      const rows = await tx.execute<{
        chunk_id: string;
        document_id: string;
        document_title: string;
        chunk_index: number;
        content: string;
        distance: number;
      }>(
        exact
          ? sql`
              with candidates as materialized (${candidates})
              select * from candidates order by distance limit ${limit}`
          : sql`
              select * from (
                ${candidates}
                order by c.embedding <=> ${vector}::vector
                limit ${limit}
              ) candidates
              order by distance`,
      );
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
