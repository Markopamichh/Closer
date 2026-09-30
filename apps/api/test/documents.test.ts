import { readFile } from "node:fs/promises";
import type { ChunkSearchHitDto, DocumentDto } from "@closer/shared";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processDocument } from "../src/ingestion/process-document";
import { documentKey, StorageNotFoundError } from "../src/lib/storage";
import type { DocumentJob } from "../src/queue/documents";
import { DOCUMENT_QUEUE } from "../src/queue/documents";
import type { World } from "./fixtures";
import { buildWorld, fileForm } from "./fixtures";
import type { Client, TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

let ctx: TestContext;
let w: World;
const base = () => `/api/organizations/${w.orgA}/documents`;

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
});

afterAll(async () => {
  await ctx.close();
});

async function upload(client: Client, name: string, content: string | Uint8Array) {
  return client.upload(base(), fileForm(name, content));
}

async function uploadOk(name: string, content: string | Uint8Array = "Some useful text.") {
  const res = await upload(w.a.owner, name, content);
  expect(res.status).toBe(201);
  return (await json<{ document: DocumentDto }>(res)).document;
}

describe("uploading documents", () => {
  it("stores the file, creates a pending document and returns no internal fields", async () => {
    const res = await upload(w.a.owner, "faq.md", "# FAQ\n\nWe open on Saturdays.");
    expect(res.status).toBe(201);
    const body = await json<{ document: Record<string, unknown> }>(res);

    expect(body.document).toMatchObject({
      title: "faq.md",
      status: "pending",
      mimeType: "text/plain",
    });
    expect(body.document).not.toHaveProperty("storagePath");
    expect(body.document).not.toHaveProperty("orgId");
    const stored = await ctx.storage.get(documentKey(w.orgA, String(body.document.id)));
    expect(new TextDecoder().decode(stored)).toContain("Saturdays");
  });

  it("queues exactly one ingestion job carrying only ids", async () => {
    const doc = await uploadOk("queued.md");
    const jobs = await ctx.documentQueue.getJobs(["waiting", "delayed", "active"]);
    const mine = jobs.filter((j) => j.data.documentId === doc.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.data).toEqual({ orgId: w.orgA, documentId: doc.id });
  });

  it("accepts PDF and DOCX", async () => {
    for (const name of ["policy.pdf", "warranty.docx"]) {
      const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
      expect((await upload(w.a.owner, name, bytes)).status).toBe(201);
    }
  });

  it("keeps only the base name of a path-like filename", async () => {
    const doc = await uploadOk("../../etc/passwd.txt");
    expect(doc.title).toBe("passwd.txt");
  });

  it.each([
    ["a mismatched type (text named .pdf)", "fake.pdf", "hello"],
    ["an unsupported extension", "sheet.csv", "a,b"],
    ["an empty file", "empty.txt", ""],
  ])("rejects %s (422)", async (_label, name, content) => {
    expect((await upload(w.a.owner, name, content)).status).toBe(422);
  });

  it("rejects files over 20 MB (413)", async () => {
    expect((await upload(w.a.owner, "huge.txt", "x".repeat(20 * 1024 * 1024 + 1))).status).toBe(
      413,
    );
  });

  it.each([
    ["owner", 201],
    ["agent", 201],
    ["viewer", 403],
  ] as const)("%s uploading → %i", async (role, status) => {
    expect((await upload(w.a[role], `by-${role}.md`, "text")).status).toBe(status);
  });
});

describe("managing documents", () => {
  it("lists and reads documents of the org", async () => {
    const doc = await uploadOk("listed.md");
    const list = await json<{ documents: DocumentDto[] }>(await w.a.viewer.request(base()));
    expect(list.documents.map((d) => d.id)).toContain(doc.id);
    expect(list.documents.map((d) => d.id)).not.toContain(w.docB.id);

    const one = await w.a.viewer.request(`${base()}/${doc.id}`);
    expect(one.status).toBe(200);
  });

  it("reprocessing a document that is still pending is a conflict (409)", async () => {
    const doc = await uploadOk("busy.md");
    const res = await w.a.owner.request(`${base()}/${doc.id}/reprocess`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("a failed document can be reprocessed (202, back to pending, re-queued)", async () => {
    const doc = await uploadOk("retry.md");
    await ctx.sql`update documents set status = 'failed', error = 'x' where id = ${doc.id}`;

    const res = await w.a.agent.request(`${base()}/${doc.id}/reprocess`, { method: "POST" });

    expect(res.status).toBe(202);
    expect((await json<{ document: DocumentDto }>(res)).document).toMatchObject({
      status: "pending",
      error: null,
    });
  });

  it("deleting removes the row, its chunks and the stored file", async () => {
    const doc = await uploadOk("to-delete.md", "Delete me with all my chunks.");
    await processDocument(
      { db: ctx.db, storage: ctx.storage, embedder: ctx.embedder, logger: ctx.logger },
      { orgId: w.orgA, documentId: doc.id, attempt: 1, maxAttempts: 1 },
    );

    const res = await w.a.owner.request(`${base()}/${doc.id}`, { method: "DELETE" });

    expect(res.status).toBe(204);
    expect(await ctx.sql`select 1 from documents where id = ${doc.id}`).toHaveLength(0);
    expect(await ctx.sql`select 1 from chunks where document_id = ${doc.id}`).toHaveLength(0);
    await expect(ctx.storage.get(documentKey(w.orgA, doc.id))).rejects.toBeInstanceOf(
      StorageNotFoundError,
    );
  });

  it.each([
    ["agent", 403],
    ["viewer", 403],
  ] as const)("%s cannot delete documents (%i)", async (role, status) => {
    const doc = await uploadOk(`keep-${role}.md`);
    expect((await w.a[role].request(`${base()}/${doc.id}`, { method: "DELETE" })).status).toBe(
      status,
    );
  });
});

describe("semantic search", () => {
  async function readyDoc(text: string) {
    const doc = await uploadOk("search-fixture.md", text);
    await processDocument(
      { db: ctx.db, storage: ctx.storage, embedder: ctx.embedder, logger: ctx.logger },
      { orgId: w.orgA, documentId: doc.id, attempt: 1, maxAttempts: 1 },
    );
    return doc;
  }

  it("returns chunks from a ready document matching the query", async () => {
    await readyDoc("# Warranty\n\nWe offer a 3-year warranty on all vehicles.");

    const res = await w.a.owner.request(`${base()}/search?q=warranty+vehicles`);
    expect(res.status).toBe(200);
    const body = await json<{ results: ChunkSearchHitDto[] }>(res);
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results[0]).toMatchObject({
      chunkId: expect.any(String) as unknown,
      documentId: expect.any(String) as unknown,
      documentTitle: "search-fixture.md",
      content: expect.stringContaining("warranty") as unknown,
      score: expect.any(Number) as unknown,
    });
  });

  it("does not return chunks from documents still pending (not ready)", async () => {
    const doc = await uploadOk("pending-search.md", "# Insurance\n\nWe sell insurance policies.");
    // doc is pending — not processed

    const res = await w.a.owner.request(`${base()}/search?q=insurance+policies`);
    expect(res.status).toBe(200);
    const body = await json<{ results: ChunkSearchHitDto[] }>(res);
    const ids = body.results.map((r) => r.documentId);
    expect(ids).not.toContain(doc.id);
  });

  it("respects the limit query parameter", async () => {
    await readyDoc("# Maintenance\n\nFull oil change service.\n\nTire rotation included.");

    const res = await w.a.owner.request(`${base()}/search?q=maintenance&limit=1`);
    expect(res.status).toBe(200);
    const body = await json<{ results: ChunkSearchHitDto[] }>(res);
    expect(body.results.length).toBeLessThanOrEqual(1);
  });

  it("returns 422 when q is missing", async () => {
    expect((await w.a.owner.request(`${base()}/search`)).status).toBe(422);
  });

  it("records the query embedding tokens as usage for the org", async () => {
    const res = await w.a.viewer.request(`${base()}/search?q=metering+probe+query`);
    expect(res.status).toBe(200);
    const rows = await ctx.sql`
      select quantity::int as quantity from usage_events
      where org_id = ${w.orgA} and type = 'embedding' and metadata->>'source' = 'search'
      order by created_at desc limit 1`;
    expect(rows[0]?.quantity).toBe(3);
  });

  it("filters out chunks whose embeddingModel differs from the query model (starvation guard)", async () => {
    const doc = await uploadOk(
      "stale-model.md",
      "# Trade-in\n\nWe accept trade-ins at market value.",
    );
    await processDocument(
      { db: ctx.db, storage: ctx.storage, embedder: ctx.embedder, logger: ctx.logger },
      { orgId: w.orgA, documentId: doc.id, attempt: 1, maxAttempts: 1 },
    );

    // Simulate a model change by overwriting the stored embeddingModel metadata so the
    // chunks look like they came from a different provider.
    await ctx.sql`update chunks set metadata = metadata || '{"embeddingModel":"old-model-v1"}'::jsonb where document_id = ${doc.id}`;

    // The route embeds with fake-bow-1024; those chunks now claim old-model-v1 — must be excluded.
    const res = await w.a.owner.request(`${base()}/search?q=trade-in+market+value`);
    expect(res.status).toBe(200);
    const body = await json<{ results: ChunkSearchHitDto[] }>(res);
    const ids = body.results.map((r) => r.documentId);
    expect(ids).not.toContain(doc.id);
  });
});

describe("end to end through the queue", () => {
  it("a real BullMQ worker picks up an upload and makes it ready", async () => {
    const connection = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
    const deps = { db: ctx.db, storage: ctx.storage, embedder: ctx.embedder, logger: ctx.logger };
    const worker = new Worker<DocumentJob>(
      DOCUMENT_QUEUE,
      (job) =>
        processDocument(deps, { ...job.data, attempt: job.attemptsMade + 1, maxAttempts: 1 }),
      { connection, prefix: process.env.QUEUE_PREFIX ?? "", concurrency: 4 },
    );
    try {
      const doc = await uploadOk("e2e.md", "# Hours\n\nWe are open Monday to Saturday, 9 to 19.");
      await expect
        .poll(
          async () =>
            (await json<{ document: DocumentDto }>(await w.a.owner.request(`${base()}/${doc.id}`)))
              .document.status,
          { timeout: 15_000, interval: 200 },
        )
        .toBe("ready");
    } finally {
      await worker.close();
      await connection.quit();
    }
  });
});
