import { randomUUID } from "node:crypto";
import type { EmbeddingProvider } from "@closer/ai";
import { EmbeddingError } from "@closer/ai";
import type { Db } from "@closer/db";
import { withTenant } from "@closer/db";
import type { DocumentDto } from "@closer/shared";
import { DOCUMENT_UPLOAD_LIMITS } from "@closer/shared";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Auth } from "../auth";
import { DOCUMENT_FORMATS, detectFormat } from "../ingestion/extract";
import { AppError, notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { RateLimiter } from "../lib/rate-limit";
import type { FileStorage } from "../lib/storage";
import { documentKey } from "../lib/storage";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { ANY_ROLE, requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";
import type { DocumentQueue } from "../queue/documents";
import { enqueueDocument } from "../queue/documents";

const searchQuerySchema = z.object({
  q: z.string().min(1).max(500),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

type DocumentRow = {
  id: string;
  title: string;
  status: DocumentDto["status"];
  error: string | null;
  mimeType: string | null;
  sizeBytes: number;
  chunkCount: number;
  createdAt: Date;
  processedAt: Date | null;
};

/** Public shape: the storage path and org id stay internal. */
const toDto = (d: DocumentRow): DocumentDto => ({
  id: d.id,
  title: d.title,
  status: d.status,
  error: d.error,
  mimeType: d.mimeType,
  sizeBytes: d.sizeBytes,
  chunkCount: d.chunkCount,
  createdAt: d.createdAt.toISOString(),
  processedAt: d.processedAt?.toISOString() ?? null,
});

/** Base name only, printable characters, bounded length. */
function titleFromFilename(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? "document";
  // eslint-disable-next-line no-control-regex -- stripping control characters on purpose
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (clean || "document").slice(0, 200);
}

const tooLarge = () => new AppError("payload_too_large", "File is too large (max 20 MB)");

/**
 * Knowledge documents scoped to `:orgId`. Uploads are stored, then processed by the
 * ingestion worker (see worker.ts); the API never parses files in the request path.
 */
export function documentRoutes(deps: {
  auth: Auth;
  db: Db;
  storage: FileStorage;
  documentQueue: DocumentQueue;
  embedder: EmbeddingProvider;
  searchLimiter: RateLimiter;
}) {
  const { auth, db, storage, documentQueue, embedder, searchLimiter } = deps;
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.get("/", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const rows = await withTenant(db, orgId, (repo) => repo.documents.list());
    return c.json({ documents: rows.map(toDto) });
  });

  r.post(
    "/",
    requireRole(db, "owner", "agent"),
    bodyLimit({
      maxSize: DOCUMENT_UPLOAD_LIMITS.maxBytes + 64 * 1024,
      onError: () => {
        throw tooLarge();
      },
    }),
    async (c) => {
      const { orgId } = c.get("membership");
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) {
        throw new AppError(
          "validation_error",
          'Upload the document as a multipart field named "file"',
        );
      }
      if (file.size > DOCUMENT_UPLOAD_LIMITS.maxBytes) throw tooLarge();
      if (file.size === 0) throw new AppError("validation_error", "The file is empty");

      const bytes = new Uint8Array(await file.arrayBuffer());
      const format = detectFormat(file.name, bytes);
      if (!format) {
        throw new AppError(
          "validation_error",
          `Unsupported or mismatched file type. Allowed: ${DOCUMENT_UPLOAD_LIMITS.extensions.join(", ")}`,
        );
      }

      const id = randomUUID();
      const key = documentKey(orgId, id);
      await storage.put(key, bytes, DOCUMENT_FORMATS[format].mimeType);

      let doc;
      try {
        doc = await withTenant(db, orgId, (repo) =>
          repo.documents.create({
            id,
            title: titleFromFilename(file.name),
            sourceType: "upload",
            mimeType: DOCUMENT_FORMATS[format].mimeType,
            sizeBytes: file.size,
            storagePath: key,
          }),
        );
      } catch (err) {
        await storage.delete(key).catch(() => undefined);
        throw err;
      }

      try {
        await enqueueDocument(documentQueue, { orgId, documentId: id });
      } catch (err) {
        c.get("logger").error({ err, documentId: id }, "failed to enqueue document");
        await withTenant(db, orgId, (repo) =>
          repo.documents.update(id, {
            status: "failed",
            error: "Could not start processing. Please retry.",
          }),
        );
        throw new AppError("internal_error", "Document stored but processing could not be queued");
      }

      return c.json({ document: toDto(doc) }, 201);
    },
  );

  r.get(
    "/search",
    requireRole(db, ...ANY_ROLE),
    validate("query", searchQuerySchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const { q, limit } = c.req.valid("query");

      // Checked before embedding, so a rejected request costs nothing and records no usage.
      let quota;
      try {
        quota = await searchLimiter.consume(`search:${orgId}`);
      } catch (err) {
        // Fail open: a Redis outage should not take search down with it.
        c.get("logger").warn({ err }, "search rate limiter unavailable; allowing request");
      }
      if (quota && !quota.allowed) {
        c.header("Retry-After", String(quota.retryAfterSeconds));
        throw new AppError("rate_limited", "Too many searches, try again shortly");
      }

      let embedded;
      try {
        embedded = await embedder.embed([q], "query");
      } catch (err) {
        // A rate-limited or unavailable provider is not a bug on our side: say so, as a 503.
        if (err instanceof EmbeddingError && err.transient) {
          c.get("logger").warn({ err }, "embedding provider unavailable for search");
          throw new AppError("service_unavailable", "Search is temporarily unavailable");
        }
        throw err;
      }
      const { embeddings, tokens } = embedded;
      const embedding = embeddings[0];
      if (!embedding) throw new AppError("internal_error", "Embedding failed");

      const { strategy, hits } = await withTenant(db, orgId, async (repo) => {
        await repo.usage.record("embedding", tokens, { source: "search", model: embedder.model });
        return repo.documents.searchChunks({ embedding, embeddingModel: embedder.model, limit });
      });

      // The query itself stays out of the logs: it is end-user text.
      c.get("logger").info({ strategy, limit, results: hits.length }, "knowledge search");
      // The model tells the UI when search runs on the offline fake embedder (not semantic).
      return c.json({ results: hits, model: embedder.model });
    },
  );

  r.get("/:documentId", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const documentId = resourceId(c.req.param("documentId"), "Document");
    const doc = await withTenant(db, orgId, (repo) => repo.documents.get(documentId));
    if (!doc) throw notFound("Document");
    return c.json({ document: toDto(doc) });
  });

  r.post("/:documentId/reprocess", requireRole(db, "owner", "agent"), async (c) => {
    const { orgId } = c.get("membership");
    const documentId = resourceId(c.req.param("documentId"), "Document");

    const doc = await withTenant(db, orgId, async (repo) => {
      const current = await repo.documents.get(documentId);
      if (!current) throw notFound("Document");
      if (current.status === "processing" || current.status === "pending") {
        throw new AppError("conflict", "The document is already being processed");
      }
      return repo.documents.update(documentId, { status: "pending", error: null });
    });
    if (!doc) throw notFound("Document");

    await enqueueDocument(documentQueue, { orgId, documentId });
    return c.json({ document: toDto(doc) }, 202);
  });

  r.delete("/:documentId", requireRole(db, "owner"), async (c) => {
    const { orgId } = c.get("membership");
    const documentId = resourceId(c.req.param("documentId"), "Document");
    const doc = await withTenant(db, orgId, (repo) => repo.documents.delete(documentId));
    if (!doc) throw notFound("Document");

    // The row (and its chunks) is gone, so the file is unreachable; cleanup is best effort.
    await storage.delete(documentKey(orgId, documentId)).catch((err: unknown) => {
      c.get("logger").warn({ err, documentId }, "failed to delete stored file");
    });
    return c.body(null, 204);
  });

  return r;
}
