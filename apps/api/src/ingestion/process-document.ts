import type { EmbeddingProvider } from "@closer/ai";
import { chunkText, EmbeddingError } from "@closer/ai";
import type { Db } from "@closer/db";
import { withTenant } from "@closer/db";
import type { Logger } from "../lib/logger";
import type { FileStorage } from "../lib/storage";
import { documentKey, StorageNotFoundError } from "../lib/storage";
import type { DocumentFormat } from "./extract";
import { DOCUMENT_FORMATS, ExtractionError, extractText } from "./extract";

export type ProcessDeps = {
  db: Db;
  storage: FileStorage;
  embedder: EmbeddingProvider;
  logger: Logger;
};

export type ProcessInput = {
  orgId: string;
  documentId: string;
  attempt: number;
  maxAttempts: number;
};

export type ProcessOutcome =
  | { kind: "ready"; chunkCount: number }
  /** Document no longer exists for this org (deleted meanwhile, or a mismatched payload). */
  | { kind: "skipped" }
  /** Permanent failure, recorded on the document. Retrying won't help. */
  | { kind: "failed"; reason: string }
  /** Transient failure with attempts left: the queue should retry. */
  | { kind: "retry"; error: Error };

class NoTextError extends Error {}

const TRANSIENT_MESSAGE = "Temporary error while processing the document. Please retry.";

const FORMAT_BY_MIME: Record<string, DocumentFormat> = {
  [DOCUMENT_FORMATS.pdf.mimeType]: "pdf",
  [DOCUMENT_FORMATS.docx.mimeType]: "docx",
  [DOCUMENT_FORMATS.text.mimeType]: "text",
};

const formatFromMime = (mimeType: string | null): DocumentFormat | null =>
  (mimeType && FORMAT_BY_MIME[mimeType]) || null;

/** Errors caused by the file or a rejected request: retrying cannot succeed. */
function isPermanent(err: unknown): boolean {
  if (err instanceof ExtractionError || err instanceof NoTextError) return true;
  if (err instanceof StorageNotFoundError) return true;
  if (err instanceof EmbeddingError) return !err.transient;
  return false;
}

/**
 * Ingests one document: download → extract → chunk → embed → store.
 * Idempotent: chunks are replaced atomically with the status update, so a retry or a
 * re-process never duplicates data. Independent of BullMQ so it can be tested directly.
 */
export async function processDocument(
  deps: ProcessDeps,
  input: ProcessInput,
): Promise<ProcessOutcome> {
  const { db, storage, embedder, logger } = deps;
  const { orgId, documentId } = input;
  const log = logger.child({ orgId, documentId, attempt: input.attempt });

  const doc = await withTenant(db, orgId, (repo) =>
    repo.documents.update(documentId, { status: "processing", error: null }),
  );
  if (!doc) {
    log.warn("document not found for org; skipping job");
    return { kind: "skipped" };
  }

  try {
    const format = formatFromMime(doc.mimeType);
    if (!format) throw new ExtractionError("Unsupported file type");

    const bytes = await storage.get(documentKey(orgId, documentId));
    const text = await extractText(format, bytes);
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new NoTextError("No readable text was found in the file");

    const { embeddings, tokens } = await embedder.embed(
      chunks.map((c) => c.content),
      "document",
    );

    const stored = await withTenant(db, orgId, async (repo) => {
      // Status first: if the document was deleted meanwhile, stop before inserting chunks.
      const updated = await repo.documents.update(documentId, {
        status: "ready",
        error: null,
        chunkCount: chunks.length,
        processedAt: new Date(),
      });
      if (!updated) return false;
      await repo.documents.replaceChunks(
        documentId,
        chunks.map((c, i) => ({
          chunkIndex: c.index,
          content: c.content,
          tokenCount: c.tokenCount,
          embedding: embeddings[i] ?? [],
          metadata: { embeddingModel: embedder.model },
        })),
      );
      await repo.usage.record("embedding", tokens, { documentId, model: embedder.model });
      return true;
    });

    if (!stored) {
      log.info("document deleted during processing; results discarded");
      return { kind: "skipped" };
    }
    log.info({ chunks: chunks.length, tokens }, "document ingested");
    return { kind: "ready", chunkCount: chunks.length };
  } catch (err) {
    const permanent = isPermanent(err);
    const lastAttempt = input.attempt >= input.maxAttempts;
    log[permanent || lastAttempt ? "error" : "warn"](
      { err, permanent },
      "document ingestion failed",
    );

    if (!permanent && !lastAttempt) {
      return { kind: "retry", error: err instanceof Error ? err : new Error(String(err)) };
    }
    // Only messages we wrote ourselves reach the user; anything else stays in the logs.
    const reason =
      err instanceof ExtractionError || err instanceof NoTextError
        ? err.message
        : err instanceof StorageNotFoundError
          ? "The uploaded file is missing. Please upload it again."
          : TRANSIENT_MESSAGE;
    // A failed re-process must not leave the previous index searchable behind a "failed" status.
    await withTenant(db, orgId, async (repo) => {
      await repo.documents.update(documentId, { status: "failed", error: reason, chunkCount: 0 });
      await repo.documents.replaceChunks(documentId, []);
    });
    return { kind: "failed", reason };
  }
}
