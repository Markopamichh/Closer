import { and, count, desc, eq, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { conversations, leads, users } from "../schema";

type Lead = typeof leads.$inferSelect;

export type LeadFilter = { status?: Lead["status"]; limit: number; offset: number };

/** What the agent learned from the customer; undefined fields are left as they are. */
export type LeadDetails = {
  name?: string;
  email?: string;
  phone?: string;
  interest?: string;
  score?: number;
};

export type LeadPatch = { status?: Lead["status"]; assignedTo?: string | null };

export function leadsRepo(tx: Tx, orgId: string) {
  const scope = (id: string) => and(eq(leads.orgId, orgId), eq(leads.id, id));

  /** Lead columns plus the assignee's name and the latest conversation, for the dashboard. */
  const withContext = {
    lead: leads,
    assigneeName: users.name,
    conversationId: sql<string | null>`(
      select ${conversations.id} from ${conversations}
      where ${conversations.orgId} = ${leads.orgId} and ${conversations.leadId} = ${leads.id}
      order by ${conversations.lastMessageAt} desc nulls last
      limit 1
    )`,
  };

  return {
    list: async (filter: LeadFilter) => {
      const conditions: (SQL | undefined)[] = [eq(leads.orgId, orgId)];
      if (filter.status) conditions.push(eq(leads.status, filter.status));
      const where = and(...conditions);
      const [rows, [totals]] = await Promise.all([
        tx
          .select(withContext)
          .from(leads)
          .leftJoin(users, eq(users.id, leads.assignedTo))
          .where(where)
          .orderBy(desc(leads.createdAt), desc(leads.id))
          .limit(filter.limit)
          .offset(filter.offset),
        tx.select({ total: count() }).from(leads).where(where),
      ]);
      return { rows, total: totals?.total ?? 0 };
    },

    get: async (id: string) => {
      const [row] = await tx
        .select(withContext)
        .from(leads)
        .leftJoin(users, eq(users.id, leads.assignedTo))
        .where(scope(id));
      return row ?? null;
    },

    update: async (id: string, patch: LeadPatch) => {
      const [row] = await tx.update(leads).set(patch).where(scope(id)).returning();
      return row ?? null;
    },

    /**
     * Creates or updates the lead of one conversation. The conversation row is locked first:
     * the agent runs a round's tool calls in parallel, and two saves must not create two leads.
     * Returns null when the conversation is not this org's.
     */
    saveForConversation: async (conversationId: string, details: LeadDetails) => {
      const [conversation] = await tx
        .select({ leadId: conversations.leadId })
        .from(conversations)
        .where(and(eq(conversations.orgId, orgId), eq(conversations.id, conversationId)))
        .for("update");
      if (!conversation) return null;

      const { interest, ...fields } = details;
      const defined = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      const metadata = interest === undefined ? {} : { interest };

      if (conversation.leadId) {
        const [row] = await tx
          .update(leads)
          .set({
            ...defined,
            metadata: sql`${leads.metadata} || ${JSON.stringify(metadata)}::jsonb`,
          })
          .where(scope(conversation.leadId))
          .returning();
        return row ?? null;
      }
      const [row] = await tx
        .insert(leads)
        .values({ ...defined, metadata, orgId })
        .returning();
      if (!row) throw new Error("leads.saveForConversation: insert returned no row");
      await tx
        .update(conversations)
        .set({ leadId: row.id })
        .where(and(eq(conversations.orgId, orgId), eq(conversations.id, conversationId)));
      return row;
    },
  };
}
