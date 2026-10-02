import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "../client";
import { aiTraces, conversations, messages, toolCalls } from "../schema";

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

export function conversationsRepo(tx: Tx, orgId: string) {
  const scope = (id: string) => and(eq(conversations.orgId, orgId), eq(conversations.id, id));

  return {
    create: async (input: { agentId: string; channel: Conversation["channel"] }) => {
      const [row] = await tx
        .insert(conversations)
        .values({ ...input, orgId })
        .returning();
      if (!row) throw new Error("conversations.create: insert returned no row");
      return row;
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
