import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "../client";
import { agents } from "../schema";

type NewAgent = Omit<typeof agents.$inferInsert, "id" | "orgId" | "createdAt" | "updatedAt">;
type AgentPatch = Partial<NewAgent>;

export function agentsRepo(tx: Tx, orgId: string) {
  const scope = (id: string) => and(eq(agents.orgId, orgId), eq(agents.id, id));

  return {
    list: () =>
      tx.select().from(agents).where(eq(agents.orgId, orgId)).orderBy(desc(agents.createdAt)),

    get: async (id: string) => {
      const [row] = await tx.select().from(agents).where(scope(id));
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
      const [row] = await tx.update(agents).set(patch).where(scope(id)).returning();
      return row ?? null;
    },

    delete: async (id: string) => {
      const rows = await tx.delete(agents).where(scope(id)).returning({ id: agents.id });
      return rows.length > 0;
    },
  };
}
