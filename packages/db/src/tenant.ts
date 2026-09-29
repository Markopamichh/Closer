import { and, desc, eq, sql } from "drizzle-orm";
import type { Db, Tx } from "./client";
import { agents } from "./schema";

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

type NewAgent = Omit<typeof agents.$inferInsert, "id" | "orgId" | "createdAt" | "updatedAt">;
type AgentPatch = Partial<NewAgent>;

/**
 * Tenant-scoped data access (layer 1). Every query filters by `orgId` explicitly and
 * every insert sets it, independently of RLS. Callers never pass org_id themselves.
 */
export function createTenantRepo(tx: Tx, orgId: string) {
  return {
    orgId,
    agents: {
      list: () =>
        tx.select().from(agents).where(eq(agents.orgId, orgId)).orderBy(desc(agents.createdAt)),

      get: async (id: string) => {
        const [row] = await tx
          .select()
          .from(agents)
          .where(and(eq(agents.orgId, orgId), eq(agents.id, id)));
        return row ?? null;
      },

      create: async (input: NewAgent) => {
        const [row] = await tx
          .insert(agents)
          .values({ ...input, orgId })
          .returning();
        if (!row) throw new Error("agents.create: insert returned no row");
        return row;
      },

      update: async (id: string, patch: AgentPatch) => {
        const [row] = await tx
          .update(agents)
          .set(patch)
          .where(and(eq(agents.orgId, orgId), eq(agents.id, id)))
          .returning();
        return row ?? null;
      },

      delete: async (id: string) => {
        const rows = await tx
          .delete(agents)
          .where(and(eq(agents.orgId, orgId), eq(agents.id, id)))
          .returning({ id: agents.id });
        return rows.length > 0;
      },
    },
  };
}

export type TenantRepo = ReturnType<typeof createTenantRepo>;
