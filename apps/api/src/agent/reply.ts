import type { AgentRun, ChatItem, EmbeddingProvider, LlmClient } from "@closer/ai";
import { chatItemSchema, costUsd, LlmError, runAgent } from "@closer/ai";
import type { Db } from "@closer/db";
import { getOrganizationName, withTenant } from "@closer/db";
import type { AgentChatEventName } from "@closer/shared";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { AppError } from "../lib/errors";
import type { Logger } from "../lib/logger";
import type { RateLimiter } from "../lib/rate-limit";
import { buildInstructions } from "./prompt";
import { createAgentTools } from "./tools";

/** How much history the model sees: bounds the cost of long conversations. */
export const HISTORY_MESSAGES = 40;

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
 * Spends one unit of each quota, in order, or throws. Fails closed: every message costs
 * model tokens, so a Redis outage must not turn into unlimited paid requests.
 */
export async function consumeChatQuotas(
  c: Context,
  logger: Logger,
  quotas: { limiter: RateLimiter; key: string; message: string }[],
) {
  for (const { limiter, key, message } of quotas) {
    let quota;
    try {
      quota = await limiter.consume(key);
    } catch (err) {
      logger.error({ err }, "chat rate limiter unavailable; rejecting request");
      throw new AppError("service_unavailable", "The agent is temporarily unavailable");
    }
    if (!quota.allowed) {
      c.header("Retry-After", String(quota.retryAfterSeconds));
      throw new AppError("rate_limited", message);
    }
  }
}

export type ReplyDeps = { db: Db; embedder: EmbeddingProvider; llm: LlmClient };

type AgentConfig = Parameters<typeof buildInstructions>[0] & { id: string; model: string };

/**
 * Streams the agent's reply to a message the caller already saved, as server-sent events
 * (start, (delta | tool)*, done | error), then persists the reply, its tool calls, traces
 * and usage. Shared by the dashboard test chat and the public widget: they differ only in
 * how the caller is authenticated and which conversation they may continue.
 */
export async function streamAgentReply(
  c: Context,
  deps: ReplyDeps,
  input: {
    orgId: string;
    agent: AgentConfig;
    conversationId: string;
    channel: "dashboard_test" | "widget";
    history: { role: string; content: string; metadata: unknown }[];
    message: string;
    logger: Logger;
  },
) {
  const { db, embedder, llm } = deps;
  const { orgId, agent, conversationId, logger } = input;
  const businessName = (await getOrganizationName(db, orgId)) ?? "this business";

  const response = streamSSE(c, async (stream) => {
    const send = (event: AgentChatEventName, data: object) =>
      stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => undefined);
    // Stop paying for tokens nobody will read once the browser goes away.
    const controller = new AbortController();
    stream.onAbort(() => {
      controller.abort();
    });

    await send("start", { conversationId });
    let run: AgentRun;
    try {
      run = await runAgent({
        llm,
        model: agent.model,
        instructions: buildInstructions(agent, businessName),
        history: [...toChatItems(input.history), { type: "user", text: input.message }],
        tools: createAgentTools({ db, orgId, conversationId, embedder }),
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
        logger.info({ conversationId }, "agent reply aborted by client");
        return;
      }
      const transient = err instanceof LlmError && err.transient;
      logger.error({ err, conversationId }, "agent reply failed");
      await withTenant(db, orgId, (repo) =>
        repo.conversations.recordTraces(conversationId, [
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
        conversationId,
        role: "assistant",
        content: run.text,
        metadata: { items: run.newItems, status: run.status, costUsd: usage.costUsd },
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
        conversationId,
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
        conversationId,
        channel: input.channel,
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
}
