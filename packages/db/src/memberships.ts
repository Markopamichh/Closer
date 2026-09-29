import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./client";
import { memberships, organizations } from "./schema";

// Identity lookups, intentionally not tenant-scoped: they are how we find out which
// tenants the caller belongs to before entering a tenant context.

export async function findMembership(db: Db, orgId: string, userId: string) {
  const [row] = await db
    .select({ orgId: memberships.orgId, userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row ?? null;
}

export function listOrganizationsForUser(db: Db, userId: string) {
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      slug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(organizations.name));
}
