import type { Db } from "@closer/db";
import { withTenant } from "@closer/db";
import type {
  ConversationDetail,
  ConversationMessageDto,
  ConversationSummaryDto,
} from "@closer/shared";
import { listConversationsQuerySchema } from "@closer/shared";
import { Hono } from "hono";
import type { Auth } from "../auth";
import { notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { ANY_ROLE, requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

type ConversationRow = {
  id: string;
  agentId: string;
  channel: ConversationSummaryDto["channel"];
  status: ConversationSummaryDto["status"];
  lastMessageAt: Date | null;
  createdAt: Date;
};

const toSummary = (
  conversation: ConversationRow,
  extra: { agentName: string; messageCount: number; lastMessage: string | null },
): ConversationSummaryDto => ({
  id: conversation.id,
  agent: { id: conversation.agentId, name: extra.agentName },
  channel: conversation.channel,
  status: conversation.status,
  messageCount: extra.messageCount,
  lastMessagePreview: extra.lastMessage,
  lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
  createdAt: conversation.createdAt.toISOString(),
});

/** Per-reply cost is written by the chat route; anything else (or older replies) has none. */
const replyCost = (metadata: Record<string, unknown>) =>
  typeof metadata.costUsd === "number" ? metadata.costUsd : null;

/**
 * Read-only conversation history, scoped to `:orgId`. Every member can read it: reviewing
 * what the agent said is what the viewer role is for. Replying as a human comes with the
 * handoff flow (Week 4).
 */
export function conversationRoutes({ auth, db }: { auth: Auth; db: Db }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.get(
    "/",
    requireRole(db, ...ANY_ROLE),
    validate("query", listConversationsQuerySchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const filter = c.req.valid("query");
      const page = await withTenant(db, orgId, (repo) => repo.conversations.list(filter));
      return c.json({
        conversations: page.rows.map((row) => toSummary(row.conversation, row)),
        total: page.total,
        limit: filter.limit,
        offset: filter.offset,
      });
    },
  );

  r.get("/:conversationId", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const conversationId = resourceId(c.req.param("conversationId"), "Conversation");

    const detail = await withTenant(db, orgId, async (repo) => {
      const conversation = await repo.conversations.get(conversationId);
      if (!conversation) return null;
      const [agent, thread, costUsd] = await Promise.all([
        repo.agents.get(conversation.agentId),
        repo.conversations.thread(conversationId),
        repo.conversations.costUsd(conversationId),
      ]);
      const calls = await repo.conversations.toolCallsFor(thread.map((m) => m.id));
      return { conversation, agent, thread, costUsd, calls };
    });
    if (!detail?.agent) throw notFound("Conversation");

    const callsByMessage = new Map<string, typeof detail.calls>();
    for (const call of detail.calls) {
      callsByMessage.set(call.messageId, [...(callsByMessage.get(call.messageId) ?? []), call]);
    }
    const messages: ConversationMessageDto[] = detail.thread.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      toolCalls: (callsByMessage.get(message.id) ?? []).map((call) => ({
        id: call.id,
        name: call.toolName,
        input: call.input,
        status: call.status,
        error: call.error,
        latencyMs: call.latencyMs,
      })),
      costUsd: replyCost(message.metadata),
      createdAt: message.createdAt.toISOString(),
    }));
    const last = detail.thread.at(-1);

    const body: ConversationDetail = {
      conversation: {
        ...toSummary(detail.conversation, {
          agentName: detail.agent.name,
          messageCount: detail.thread.length,
          lastMessage: last ? last.content.slice(0, 160) : null,
        }),
        costUsd: detail.costUsd,
        messages,
      },
    };
    return c.json(body);
  });

  return r;
}
