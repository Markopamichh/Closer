import { readFile } from "node:fs/promises";
import type { EmbeddingProvider } from "@closer/ai";
import { EmbeddingError } from "@closer/ai";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProcessDeps } from "../src/ingestion/process-document";
import { processDocument } from "../src/ingestion/process-document";
import { documentKey } from "../src/lib/storage";
import type { World } from "./fixtures";
import { buildWorld, fileForm } from "./fixtures";
import type { Client, TestContext } from "./helpers";
import { createTestContext, json } from "./helpers";

let ctx: TestContext;
let w: World;
let deps: ProcessDeps;

beforeAll(async () => {
  ctx = createTestContext();
  w = await buildWorld(ctx);
  deps = { db: ctx.db, storage: ctx.storage, embedder: ctx.embedder, logger: ctx.logger };
});

afterAll(async () => {
  await ctx.close();
});

async function upload(client: Client, orgId: string, name: string, content: string | Uint8Array) {
  const res = await client.upload(`/api/organizations/${orgId}/documents`, fileForm(name, content));
  expect(res.status).toBe(201);
  return (await json<{ document: { id: string } }>(res)).document.id;
}

const once = (orgId: string, documentId: string) =>
  processDocument(deps, { orgId, documentId, attempt: 1, maxAttempts: 1 });

async function documentRow(id: string) {
  const [row] = await ctx.sql<
    { status: string; error: string | null; chunk_count: number; org_id: string }[]
  >`
    select status, error, chunk_count, org_id from documents where id = ${id}`;
  return row;
}

async function chunkRows(documentId: string) {
  return ctx.sql<
    { org_id: string; chunk_index: number; dims: number; metadata: { embeddingModel: string } }[]
  >`
    select org_id, chunk_index, vector_dims(embedding) as dims, metadata
    from chunks where document_id = ${documentId} order by chunk_index`;
}

const longText = Array.from(
  { length: 40 },
  (_, i) => `Section ${i}. ${"Financing terms and warranty details for used vehicles. ".repeat(8)}`,
).join("\n\n");

describe("processDocument", () => {
  it("ingests a document: chunks with 1024-d embeddings, status ready, usage recorded", async () => {
    const id = await upload(w.a.owner, w.orgA, "guide.md", longText);

    const outcome = await once(w.orgA, id);

    expect(outcome.kind).toBe("ready");
    const doc = await documentRow(id);
    const chunks = await chunkRows(id);
    expect(doc).toMatchObject({ status: "ready", error: null });
    expect(chunks.length).toBeGreaterThan(1);
    expect(doc?.chunk_count).toBe(chunks.length);
    expect(chunks.every((c) => c.org_id === w.orgA && c.dims === 1024)).toBe(true);
    expect(chunks[0]?.metadata.embeddingModel).toBe(ctx.embedder.model);
    const usage = await ctx.sql`
      select quantity from usage_events
      where org_id = ${w.orgA} and type = 'embedding' and metadata->>'documentId' = ${id}`;
    expect(usage).toHaveLength(1);
  });

  it("extracts real PDF and DOCX files", async () => {
    for (const name of ["policy.pdf", "warranty.docx"]) {
      const bytes = new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)));
      const id = await upload(w.a.owner, w.orgA, name, bytes);
      expect((await once(w.orgA, id)).kind).toBe("ready");
    }
  });

  it("is idempotent: processing twice leaves the same chunks, no duplicates", async () => {
    const id = await upload(w.a.owner, w.orgA, "twice.md", longText);
    await once(w.orgA, id);
    const first = await chunkRows(id);

    // The second run must succeed, not merely leave the first run's rows in place.
    expect((await once(w.orgA, id)).kind).toBe("ready");

    const second = await chunkRows(id);
    expect(second.map((c) => c.chunk_index)).toEqual(first.map((c) => c.chunk_index));
    expect((await documentRow(id))?.status).toBe("ready");
  });

  it("refuses a job whose orgId doesn't own the document (tampered payload)", async () => {
    const outcome = await once(w.orgA, w.docB.id);

    expect(outcome.kind).toBe("skipped");
    expect((await documentRow(w.docB.id))?.status).toBe("pending");
    expect(await chunkRows(w.docB.id)).toHaveLength(0);
  });

  it("fails permanently, with a readable reason, for a corrupt file", async () => {
    const id = await upload(w.a.owner, w.orgA, "broken.pdf", "%PDF-1.7 this is not really a pdf");

    const outcome = await processDocument(deps, {
      orgId: w.orgA,
      documentId: id,
      attempt: 1,
      maxAttempts: 3,
    });

    expect(outcome.kind).toBe("failed");
    expect(await documentRow(id)).toMatchObject({ status: "failed", chunk_count: 0 });
    expect((await documentRow(id))?.error).toMatch(/Could not read the PDF file/);
  });

  it("fails permanently when the file has no readable text", async () => {
    const id = await upload(w.a.owner, w.orgA, "blank.txt", " \n\n \t \n");
    expect(await once(w.orgA, id)).toEqual({
      kind: "failed",
      reason: "No readable text was found in the file",
    });
  });

  it("fails permanently when the stored file is missing", async () => {
    const id = await upload(w.a.owner, w.orgA, "gone.md", "Some text");
    await ctx.storage.delete(documentKey(w.orgA, id));

    const outcome = await once(w.orgA, id);

    expect(outcome.kind).toBe("failed");
    expect((await documentRow(id))?.error).toMatch(/missing/);
  });

  describe("transient failures", () => {
    const flaky: EmbeddingProvider = {
      model: "flaky",
      embed: () => Promise.reject(new Error("connect ETIMEDOUT 10.0.0.7:443 secret-host")),
    };

    it("asks the queue to retry while attempts remain, without marking the document failed", async () => {
      const id = await upload(w.a.owner, w.orgA, "retry.md", "Retry me");

      const outcome = await processDocument(
        { ...deps, embedder: flaky },
        { orgId: w.orgA, documentId: id, attempt: 1, maxAttempts: 3 },
      );

      expect(outcome.kind).toBe("retry");
      expect((await documentRow(id))?.status).toBe("processing");
    });

    it("on the last attempt, fails with a generic message that hides internals", async () => {
      const id = await upload(w.a.owner, w.orgA, "last.md", "Last try");

      const outcome = await processDocument(
        { ...deps, embedder: flaky },
        { orgId: w.orgA, documentId: id, attempt: 3, maxAttempts: 3 },
      );

      expect(outcome.kind).toBe("failed");
      const error = (await documentRow(id))?.error ?? "";
      expect(error).toMatch(/Temporary error/);
      expect(error).not.toMatch(/ETIMEDOUT|secret-host/);
    });

    it("does not retry a rejected API key (4xx from the embedding provider)", async () => {
      const id = await upload(w.a.owner, w.orgA, "badkey.md", "Bad key");
      const rejected: EmbeddingProvider = {
        model: "voyage-4",
        embed: () =>
          Promise.reject(new EmbeddingError("Voyage request failed with status 401", 401)),
      };

      const outcome = await processDocument(
        { ...deps, embedder: rejected },
        { orgId: w.orgA, documentId: id, attempt: 1, maxAttempts: 3 },
      );

      expect(outcome.kind).toBe("failed");
    });
  });

  it("discards results if the document is deleted while it is being processed", async () => {
    const id = await upload(w.a.owner, w.orgA, "deleted.md", longText);
    const deletingEmbedder: EmbeddingProvider = {
      model: ctx.embedder.model,
      embed: async (texts, type) => {
        await ctx.sql`delete from documents where id = ${id}`;
        return ctx.embedder.embed(texts, type);
      },
    };

    const outcome = await processDocument(
      { ...deps, embedder: deletingEmbedder },
      { orgId: w.orgA, documentId: id, attempt: 1, maxAttempts: 1 },
    );

    expect(outcome.kind).toBe("skipped");
    expect(await chunkRows(id)).toHaveLength(0);
  });
});
