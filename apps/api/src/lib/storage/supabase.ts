import type { FileStorage } from "./types";
import { assertValidKey, StorageNotFoundError } from "./types";

type Options = {
  url: string;
  /** service_role key: server-only, never sent to the browser. */
  serviceRoleKey: string;
  bucket: string;
  fetch?: typeof fetch;
};

/** Supabase Storage (private bucket) over its REST API. */
export function createSupabaseStorage(options: Options): FileStorage {
  const doFetch = options.fetch ?? fetch;
  const base = `${options.url.replace(/\/$/, "")}/storage/v1/object`;
  const auth = {
    Authorization: `Bearer ${options.serviceRoleKey}`,
    apikey: options.serviceRoleKey,
  };

  async function check(res: Response, key: string, action: string) {
    if (res.ok) return;
    if (res.status === 404 || res.status === 400) {
      // Supabase answers 400 "Object not found" for missing keys on some endpoints.
      const text = await res.text();
      if (res.status === 404 || text.includes("not_found") || text.includes("Object not found")) {
        throw new StorageNotFoundError(key);
      }
    }
    throw new Error(`Supabase storage ${action} failed with status ${res.status}`);
  }

  return {
    async put(key, data, contentType) {
      assertValidKey(key);
      const res = await doFetch(`${base}/${options.bucket}/${key}`, {
        method: "POST",
        headers: { ...auth, "Content-Type": contentType, "x-upsert": "true" },
        body: data,
      });
      await check(res, key, "upload");
    },
    async get(key) {
      assertValidKey(key);
      const res = await doFetch(`${base}/${options.bucket}/${key}`, { headers: auth });
      await check(res, key, "download");
      return new Uint8Array(await res.arrayBuffer());
    },
    async delete(key) {
      assertValidKey(key);
      const res = await doFetch(`${base}/${options.bucket}`, {
        method: "DELETE",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: [key] }),
      });
      await check(res, key, "delete");
    },
  };
}
