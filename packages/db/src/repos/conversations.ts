import { and, asc, count, desc, eq, inArray, sql, sum } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { Tx } from "../client";
import { agents, aiTraces, conversations, messages, toolCalls } from "../schema";

type Conversation = typeof conversations.$inferSelect;
type Message = typeof messages.$inferSelect;
type MessageRole = Message["role"];
type CallStatus = (typeof toolCalls.$inferInsert)["status"];

export type NewToolCall = {
  toolName: string;
  input: unknown;
  output: unknown;
  status: CallStatus;
  error?: string | null;
  latencyMs: number;
};

export type NewAiTrace = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  latencyMs: number;
  status: CallStatus;
  error?: string | null;
};

export type ConversationFilter = {
  agentId?: string;
  channel?: Conversation["channel"];
  limit: number;
  offset: number;
};

/** Characters of the last message shown in a conversation list row. */
const PREVIEW_CHARS = 160;
/** Upper bound for one conversation thread; a test chat never gets near it. */
const MAX_THREAD_MESSAGES = 500;

export function conversationsRepo(tx: Tx, orgId: string) {
  const scope = (id: string) => and(eq(conversations.orgId, orgId), eq(conversations.id, id));

  return {
    create: async (input: {
      agentId: string;
      channel: Conversation["channel"];
      visitorId?: string;
    }) => {
      const [row] = await tx
        .insert(conversations)
        .values({ ...input, orgId })
        .returning();
      if (!row) throw new Error("conversations.create: insert returned no row");
      return row;
    },

    /** Newest activity first, with the agent name, message count and a last-message preview. */
    list: async (filter: ConversationFilter) => {
      const conditions: (SQL | undefined)[] = [eq(conversations.orgId, orgId)];
      if (filter.agentId) conditions.push(eq(conversations.agentId, filter.agentId));
      if (filter.channel) conditions.push(eq(conversations.channel, filter.channel));
      const where = and(...conditions);

      const [rows, [totals]] = await Promise.all([
        tx
          .select({
            conversation: conversations,
            agentName: agents.name,
            messageCount: sql<number>`(
              select count(*)::int from ${messages}
              where ${messages.orgId} = ${conversations.orgId}
                and ${messages.conversationId} = ${conversations.id}
            )`,
            lastMessage: sql<string | null>`(
              select left(${messages.content}, ${PREVIEW_CHARS}) from ${messages}
              where ${messages.orgId} = ${conversations.orgId}
                and ${messages.conversationId} = ${conversations.id}
              order by ${messages.createdAt} desc, ${messages.id} desc
              limit 1
            )`,
          })
          .from(conversations)
          .innerJoin(
            agents,
            and(eq(agents.orgId, conversations.orgId), eq(agents.id, conversations.agentId)),
          )
          .where(where)
          // A conversation without messages yet sorts by when it was opened.
          .orderBy(
            desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`),
            desc(conversations.id),
          )
          .limit(filter.limit)
          .offset(filter.offset),
        tx.select({ total: count() }).from(conversations).where(where),
      ]);
      return { rows, total: totals?.total ?? 0 };
    },

    /** The whole thread, oldest first (capped), for reading in the dashboard. */
    thread: (conversationId: string) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.orgId, orgId), eq(messages.conversationId, conversationId)))
        .orderBy(asc(messages.createdAt), asc(messages.id))
        .limit(MAX_THREAD_MESSAGES),

    /** Total model spend on a conversation, failed calls included. */
    costUsd: async (conversationId: string) => {
      const [row] = await tx
        .select({ total: sum(aiTraces.costUsd) })
        .from(aiTraces)
        .where(and(eq(aiTraces.orgId, orgId), eq(aiTraces.conversationId, conversationId)));
      return Number(row?.total ?? 0);
    },

    get: async (id: string) => {
      const [row] = await tx.select().from(conversations).where(scope(id));
      return row ?? null;
    },

    /** The most recent `limit` messages, oldest first: the window the model gets to see. */
    recentMessages: async (conversationId: string, limit: number) => {
      const recent = await tx
        .select()
        .from(messages)
        .where(and(eq(messages.orgId, orgId), eq(messages.conversationId, conversationId)))
        .orderBy(desc(messages.createdAt), desc(messages.id))
        .limit(limit);
      return recent.reverse();
    },

    /** Appends a message and bumps the conversation; history is never edited. */
    addMessage: async (input: {
      conversationId: string;
      role: MessageRole;
      content: string;
      metadata?: Record<string, unknown>;
    }) => {
      const [row] = await tx
        .insert(messages)
        .values({ ...input, metadata: input.metadata ?? {}, orgId })
        .returning();
      if (!row) throw new Error("conversations.addMessage: insert returned no row");
      await tx
        .update(conversations)
        .set({ lastMessageAt: row.createdAt })
        .where(scope(input.conversationId));
      return row;
    },

    recordToolCalls: async (messageId: string, calls: NewToolCall[]) => {
      if (calls.length === 0) return;
      await tx.insert(toolCalls).values(calls.map((call) => ({ ...call, messageId, orgId })));
    },

    recordTraces: async (conversationId: string, traces: NewAiTrace[]) => {
      if (traces.length === 0) return;
      await tx.insert(aiTraces).values(
        traces.map((trace) => ({
          ...trace,
          conversationId,
          orgId,
          costUsd: trace.costUsd.toFixed(6),
        })),
      );
    },

    toolCallsFor: (messageIds: string[]) =>
      messageIds.length === 0
        ? Promise.resolve([])
        : tx
            .select()
            .from(toolCalls)
            .where(and(eq(toolCalls.orgId, orgId), inArray(toolCalls.messageId, messageIds)))
            .orderBy(asc(toolCalls.createdAt)),
  };
}
