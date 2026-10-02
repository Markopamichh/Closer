import type { AgentRun, ChatItem, EmbeddingProvider, LlmClient } from "@closer/ai";
import { chatItemSchema, costUsd, LlmError, runAgent } from "@closer/ai";
import type { Db } from "@closer/db";
import { getOrganizationName, withTenant } from "@closer/db";
import type { AgentChatEventName } from "@closer/shared";
import { agentChatRequestSchema } from "@closer/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { buildInstructions } from "../agent/prompt";
import { createAgentTools } from "../agent/tools";
import type { Auth } from "../auth";
import { AppError, notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { RateLimiter } from "../lib/rate-limit";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

/** How much history the model sees: bounds the cost of long conversations. */
const HISTORY_MESSAGES = 40;

const storedItems = chatItemSchema.array();

/** Stored messages back to model items; malformed metadata degrades to the plain text. */
function toChatItems(messages: { role: string; content: string; metadata: unknown }[]): ChatItem[] {
  return messages.flatMap((message): ChatItem[] => {
    if (message.role === "user") return [{ type: "user", text: message.content }];
    if (message.role !== "assistant") return [];
    const items =
      typeof message.metadata === "object" &&
      message.metadata !== null &&
      "items" in message.metadata
        ? storedItems.safeParse(message.metadata.items)
        : null;
    return items?.success ? items.data : [{ type: "assistant", text: message.content }];
  });
}

function totals(run: AgentRun) {
  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  for (const turn of run.turns) {
    inputTokens += turn.usage.inputTokens;
    cachedInputTokens += turn.usage.cachedInputTokens;
    outputTokens += turn.usage.outputTokens;
    cost += costUsd(turn.model, turn.usage) ?? 0;
  }
  return { inputTokens, cachedInputTokens, outputTokens, costUsd: cost };
}

/**
 * Dashboard test chat with an AI agent, streamed as server-sent events. Owners and agents
 * (team members) can test; every reply is persisted, traced and metered like a real one.
 */
export function agentChatRoutes(deps: {
  auth: Auth;
  db: Db;
  embedder: EmbeddingProvider;
  llm: LlmClient | null;
  chatLimiter: RateLimiter;
}) {
  const { auth, db, embedder, llm, chatLimiter } = deps;
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

      // Fails closed, unlike knowledge search: every message spends model tokens, so a
      // Redis outage must not turn into unlimited paid requests. A short 503 is cheaper.
      let quota;
      try {
        quota = await chatLimiter.consume(`chat:${orgId}`);
      } catch (err) {
        logger.error({ err }, "chat rate limiter unavailable; rejecting request");
        throw new AppError("service_unavailable", "The agent is temporarily unavailable");
      }
      if (!quota.allowed) {
        c.header("Retry-After", String(quota.retryAfterSeconds));
        throw new AppError("rate_limited", "Too many messages, try again shortly");
      }

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
      const { agent, conversation, history } = setup;
      const businessName = (await getOrganizationName(db, orgId)) ?? "this business";

      const response = streamSSE(c, async (stream) => {
        const send = (event: AgentChatEventName, data: object) =>
          stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
        // Stop paying for tokens nobody will read once the browser goes away.
        const controller = new AbortController();
        stream.onAbort(() => {
          controller.abort();
        });

        await send("start", { conversationId: conversation.id });
        let run: AgentRun;
        try {
          run = await runAgent({
            llm,
            model: agent.model,
            instructions: buildInstructions(agent, businessName),
            history: [...toChatItems(history), { type: "user", text: body.message }],
            tools: createAgentTools({ db, orgId, embedder }),
            cacheKey: `agent:${agent.id}`,
            signal: controller.signal,
            onEvent: (event) => {
              if (event.type === "text_delta") void send("delta", { text: event.delta });
              else
                void send("tool", {
                  name: event.name,
                  phase: event.type === "tool_start" ? "start" : "end",
                  ...(event.type === "tool_end" ? { ok: event.ok } : {}),
                });
            },
          });
        } catch (err) {
          if (controller.signal.aborted) {
            logger.info({ conversationId: conversation.id }, "agent reply aborted by client");
            return;
          }
          const transient = err instanceof LlmError && err.transient;
          logger.error({ err, conversationId: conversation.id }, "agent reply failed");
          await withTenant(db, orgId, (repo) =>
            repo.conversations.recordTraces(conversation.id, [
              {
                model: agent.model,
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 0,
                costUsd: 0,
                latencyMs: 0,
                status: "error",
                error: err instanceof LlmError ? err.message : "Agent run failed",
              },
            ]),
          );
          await send("error", { code: transient ? "unavailable" : "failed" });
          return;
        }

        const usage = totals(run);
        const message = await withTenant(db, orgId, async (repo) => {
          const saved = await repo.conversations.addMessage({
            conversationId: conversation.id,
            role: "assistant",
            content: run.text,
            metadata: { items: run.newItems, status: run.status },
          });
          await repo.conversations.recordToolCalls(
            saved.id,
            run.toolCalls.map((call) => ({
              toolName: call.name,
              input: call.input,
              output: call.output,
              status: call.status,
              error: call.error ?? null,
              latencyMs: call.latencyMs,
            })),
          );
          await repo.conversations.recordTraces(
            conversation.id,
            run.turns.map((turn) => ({
              model: turn.model,
              inputTokens: turn.usage.inputTokens,
              outputTokens: turn.usage.outputTokens,
              cacheReadTokens: turn.usage.cachedInputTokens,
              costUsd: costUsd(turn.model, turn.usage) ?? 0,
              latencyMs: turn.latencyMs,
              status: "success",
            })),
          );
          await repo.usage.record("ai_message", 1, {
            agentId: agent.id,
            conversationId: conversation.id,
            channel: "dashboard_test",
          });
          return saved;
        });
        await send("done", { messageId: message.id, usage });
      });
      // Proxies and CDNs compress (and therefore buffer) responses unless told not to: a
      // gzipped event stream reached the browser in one piece at the end. no-transform stops
      // that (Next's proxy honours it); X-Accel-Buffering does the same for nginx. Set on
      // the response because streamSSE overwrites Cache-Control.
      response.headers.set("Cache-Control", "no-cache, no-transform");
      response.headers.set("X-Accel-Buffering", "no");
      return response;
    },
  );

  return r;
}
