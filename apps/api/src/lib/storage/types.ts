/** Binary object storage for uploaded documents. Keys never include user input. */
export interface FileStorage {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const KEY_PATTERN = new RegExp(`^${UUID}/${UUID}$`);

/**
 * `<orgId>/<documentId>`. The original filename is kept in the database, never in the
 * key, so it can't be used for path traversal and objects are grouped per tenant.
 */
export function documentKey(orgId: string, documentId: string): string {
  const key = `${orgId}/${documentId}`;
  assertValidKey(key);
  return key;
}

export function assertValidKey(key: string): void {
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid storage key");
}

export class StorageNotFoundError extends Error {
  constructor(key: string) {
    super(`Object not found: ${key}`);
    this.name = "StorageNotFoundError";
  }
}
