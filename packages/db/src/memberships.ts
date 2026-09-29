import { and, eq } from "drizzle-orm";
import type { Db } from "./client";
import { memberships } from "./schema";

/**
 * Identity lookup, intentionally not tenant-scoped: it is how we find out which
 * tenant (if any) the caller belongs to before entering a tenant context.
 */
export async function findMembership(db: Db, orgId: string, userId: string) {
  const [row] = await db
    .select({ orgId: memberships.orgId, userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row ?? null;
}
