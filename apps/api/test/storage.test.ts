import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createLocalStorage } from "../src/lib/storage/local";
import { createSupabaseStorage } from "../src/lib/storage/supabase";
import { documentKey, StorageNotFoundError } from "../src/lib/storage/types";

const orgId = "11111111-1111-4111-8111-111111111111";
const docId = "22222222-2222-4222-8222-222222222222";
const key = documentKey(orgId, docId);
const bytes = new TextEncoder().encode("hello closer");

describe("storage keys", () => {
  it.each([
    "../../etc/passwd",
    `${orgId}/../${docId}`,
    `${orgId}/${docId}/extra`,
    `${orgId}/report.pdf`,
    "",
  ])("rejects %j before touching the filesystem", async (bad) => {
    await expect(createLocalStorage("/tmp/unused").get(bad)).rejects.toThrow("Invalid storage key");
  });

  it("builds keys as <orgId>/<documentId>", () => {
    expect(key).toBe(`${orgId}/${docId}`);
  });
});

describe("local storage", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "closer-storage-"));
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips bytes and deletes idempotently", async () => {
    const storage = createLocalStorage(dir);
    await storage.put(key, bytes, "text/plain");
    expect(new TextDecoder().decode(await storage.get(key))).toBe("hello closer");

    await storage.delete(key);
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
  });
});

describe("supabase storage", () => {
  const make = (fetchMock: typeof fetch) =>
    createSupabaseStorage({
      url: "https://proj.supabase.co/",
      serviceRoleKey: "service-key",
      bucket: "documents",
      fetch: fetchMock,
    });

  it("uploads to the bucket path with the service key and upsert", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ Key: key }));
    await make(fetchMock).put(key, bytes, "application/pdf");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://proj.supabase.co/storage/v1/object/documents/${key}`);
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer service-key",
      "Content-Type": "application/pdf",
      "x-upsert": "true",
    });
  });

  it("maps a missing object to StorageNotFoundError", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"error":"not_found","message":"Object not found"}', { status: 400 }),
      );
    await expect(make(fetchMock).get(key)).rejects.toBeInstanceOf(StorageNotFoundError);
  });

  it("does not leak response bodies in other errors", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("secret detail", { status: 500 }));
    await expect(make(fetchMock).get(key)).rejects.toThrow(
      "Supabase storage download failed with status 500",
    );
  });
});
