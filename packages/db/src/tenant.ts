import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client";
import { agentsRepo } from "./repos/agents";
import { documentsRepo } from "./repos/documents";
import { inventoryRepo } from "./repos/inventory";
import { usageRepo } from "./repos/usage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction with `app.org_id` set for RLS (layer 2).
 * The setting is transaction-local (`set_config(..., true)`), so it can never leak
 * to another request through a pooled connection.
 */
export async function withTenant<T>(
  db: Db,
  orgId: string,
  fn: (repo: TenantRepo, tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(orgId)) {
    throw new Error("withTenant: orgId must be a UUID");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(createTenantRepo(tx, orgId), tx);
  });
}

/**
 * Tenant-scoped data access (layer 1). Every query filters by `orgId` explicitly and
 * every insert sets it, independently of RLS. Callers never pass org_id themselves.
 */
export function createTenantRepo(tx: Tx, orgId: string) {
  return {
    orgId,
    agents: agentsRepo(tx, orgId),
    inventory: inventoryRepo(tx, orgId),
    documents: documentsRepo(tx, orgId),
    usage: usageRepo(tx, orgId),
  };
}

export type TenantRepo = ReturnType<typeof createTenantRepo>;
export type { NewChunk, NewDocument } from "./repos/documents";
export type { InventoryFilter, InventoryItemPatch, NewInventoryItem } from "./repos/inventory";
