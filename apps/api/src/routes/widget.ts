import type { EmbeddingProvider, LlmClient } from "@closer/ai";
import type { Db } from "@closer/db";
import { lookupWidget, withTenant } from "@closer/db";
import { widgetChatRequestSchema, widgetPublicKeySchema } from "@closer/shared";
import { Hono } from "hono";
import { consumeChatQuotas, HISTORY_MESSAGES, streamAgentReply } from "../agent/reply";
import type { BaseVariables } from "../lib/context";
import { AppError, notFound } from "../lib/errors";
import type { RateLimiter } from "../lib/rate-limit";
import { validate } from "../middleware/validate";

/**
 * Public widget API, used by anonymous visitors of a business's site. No cookies and no
 * session: the tenant comes from the widget's public key (resolved by a narrow DB
 * function), never from the body. Being cookieless, there is nothing for CSRF to ride on.
 *
 * Abuse bounds, outermost first: per-org minute limit and per-org daily cap (shared with
 * the test chat: one budget), then a per-visitor limit so one visitor can't use up the
 * org's minute. The visitor id is client-chosen, so that last one is fairness, not security.
 */
export function widgetRoutes(deps: {
  db: Db;
  embedder: EmbeddingProvider;
  llm: LlmClient | null;
  chatLimiter: RateLimiter;
  dailyChatLimiter: RateLimiter;
  visitorChatLimiter: RateLimiter;
}) {
  const { db, embedder, llm, chatLimiter, dailyChatLimiter, visitorChatLimiter } = deps;
  const r = new Hono<{ Variables: BaseVariables }>();

  /** Unknown, malformed and disabled keys all look the same: a plain 404. */
  const resolve = async (rawKey: string | undefined) => {
    const key = widgetPublicKeySchema.safeParse(rawKey);
    if (!key.success) throw notFound("Widget");
    const widget = await lookupWidget(db, key.data);
    if (!widget?.enabled) throw notFound("Widget");
    return { ...widget, publicKey: key.data };
  };

  r.post("/:publicKey/chat", validate("json", widgetChatRequestSchema), async (c) => {
    const body = c.req.valid("json");
    const logger = c.get("logger");
    const widget = await resolve(c.req.param("publicKey"));
    const { orgId, agentId } = widget;
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
      {
        limiter: visitorChatLimiter,
        key: `chat-visitor:${widget.publicKey}:${body.visitorId}`,
        message: "Too many messages, try again shortly",
      },
    ]);

    const setup = await withTenant(db, orgId, async (repo) => {
      const agent = await repo.agents.get(agentId);
      if (!agent) return null;
      const conversation = body.conversationId
        ? await repo.conversations.get(body.conversationId)
        : await repo.conversations.create({
            agentId,
            channel: "widget",
            visitorId: body.visitorId,
          });
      // Only this visitor's widget conversations with this agent.
      if (
        !conversation ||
        conversation.agentId !== agentId ||
        conversation.channel !== "widget" ||
        conversation.visitorId !== body.visitorId
      ) {
        return null;
      }
      const history = await repo.conversations.recentMessages(conversation.id, HISTORY_MESSAGES);
      await repo.conversations.addMessage({
        conversationId: conversation.id,
        role: "user",
        content: body.message,
      });
      return { agent, conversation, history };
    });
    if (!setup) throw notFound(body.conversationId ? "Conversation" : "Widget");

    return streamAgentReply(
      c,
      { db, embedder, llm },
      {
        orgId,
        agent: setup.agent,
        conversationId: setup.conversation.id,
        channel: "widget",
        history: setup.history,
        message: body.message,
        logger,
      },
    );
  });

  return r;
}
