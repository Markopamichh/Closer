import type { EmbeddingProvider, LlmClient } from "@closer/ai";
import type { Db } from "@closer/db";
import { withTenant } from "@closer/db";
import { agentChatRequestSchema } from "@closer/shared";
import { Hono } from "hono";
import { consumeChatQuotas, HISTORY_MESSAGES, streamAgentReply } from "../agent/reply";
import type { Auth } from "../auth";
import { AppError, notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { RateLimiter } from "../lib/rate-limit";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

/**
 * Dashboard test chat with an AI agent, streamed as server-sent events. Owners and agents
 * (team members) can test; every reply is persisted, traced and metered like a real one,
 * and counts against the same per-org quotas as the public widget.
 */
export function agentChatRoutes(deps: {
  auth: Auth;
  db: Db;
  embedder: EmbeddingProvider;
  llm: LlmClient | null;
  chatLimiter: RateLimiter;
  dailyChatLimiter: RateLimiter;
}) {
  const { auth, db, embedder, llm, chatLimiter, dailyChatLimiter } = deps;
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.post(
    "/",
    requireRole(db, "owner", "agent"),
    validate("json", agentChatRequestSchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const agentId = resourceId(c.req.param("agentId"), "Agent");
      const body = c.req.valid("json");
      const logger = c.get("logger");
      if (!llm) throw new AppError("service_unavailable", "The agent model is not configured");

      await consumeChatQuotas(c, logger, [
        {
          limiter: chatLimiter,
          key: `chat:${orgId}`,
          message: "Too many messages, try again shortly",
        },
        {
          limiter: dailyChatLimiter,
          key: `chat-daily:${orgId}`,
          message: "Daily message limit reached",
        },
      ]);

      const setup = await withTenant(db, orgId, async (repo) => {
        const agent = await repo.agents.get(agentId);
        if (!agent) return null;
        const conversation = body.conversationId
          ? await repo.conversations.get(body.conversationId)
          : await repo.conversations.create({ agentId, channel: "dashboard_test" });
        // Only this agent's test conversations: no continuing a widget chat from here.
        if (
          !conversation ||
          conversation.agentId !== agentId ||
          conversation.channel !== "dashboard_test"
        ) {
          return null;
        }
        const history = await repo.conversations.recentMessages(conversation.id, HISTORY_MESSAGES);
        // Saved before calling the model, so the question survives a failed reply.
        await repo.conversations.addMessage({
          conversationId: conversation.id,
          role: "user",
          content: body.message,
        });
        return { agent, conversation, history };
      });
      if (!setup) throw notFound(body.conversationId ? "Conversation" : "Agent");

      return streamAgentReply(
        c,
        { db, embedder, llm },
        {
          orgId,
          agent: setup.agent,
          conversationId: setup.conversation.id,
          channel: "dashboard_test",
          history: setup.history,
          message: body.message,
          logger,
        },
      );
    },
  );

  return r;
}
