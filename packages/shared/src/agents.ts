import { z } from "zod";

export const AGENT_TONES = ["friendly", "professional", "concise", "enthusiastic"] as const;

/**
 * Models an agent may use. A closed list: an arbitrary id would fail on every message at
 * runtime and could not be priced. `gpt-5-nano` is the cheapest (owner's choice); evals in
 * Week 5 decide whether one of the others is worth its price.
 */
export const AGENT_MODELS = ["gpt-5-nano", "gpt-6-luna", "gpt-5.6-luna", "gpt-5-mini"] as const;
export type AgentModel = (typeof AGENT_MODELS)[number];
export const DEFAULT_AGENT_MODEL: AgentModel = "gpt-5-nano";

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  systemPrompt: z.string().max(20_000).default(""),
  tone: z.enum(AGENT_TONES).default("friendly"),
  rules: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  model: z.enum(AGENT_MODELS).default(DEFAULT_AGENT_MODEL),
  isActive: z.boolean().default(true),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

// `.strict()` so unknown keys (e.g. orgId, id) are rejected instead of silently dropped.
export const updateAgentSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    systemPrompt: z.string().max(20_000),
    tone: z.enum(AGENT_TONES),
    rules: z.array(z.string().trim().min(1).max(500)).max(50),
    model: z.enum(AGENT_MODELS),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

/** Agent as the API returns it (org_id and other internal columns stay out). */
export const agentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  systemPrompt: z.string(),
  tone: z.enum(AGENT_TONES),
  rules: z.array(z.string()),
  model: z.enum(AGENT_MODELS),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgentDto = z.infer<typeof agentSchema>;
export const agentListSchema = z.object({ agents: z.array(agentSchema) });
export const agentResponseSchema = z.object({ agent: agentSchema });

export const agentChatRequestSchema = z.object({
  /** Omit to start a new conversation. */
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(2000),
});
export type AgentChatRequest = z.infer<typeof agentChatRequestSchema>;

/** Server-sent events of a test chat reply, in order: start, (delta | tool)*, done | error. */
export const agentChatEventSchemas = {
  start: z.object({ conversationId: z.uuid() }),
  delta: z.object({ text: z.string() }),
  tool: z.object({ name: z.string(), phase: z.enum(["start", "end"]), ok: z.boolean().optional() }),
  done: z.object({
    messageId: z.uuid(),
    usage: z.object({
      inputTokens: z.number().int(),
      cachedInputTokens: z.number().int(),
      outputTokens: z.number().int(),
      costUsd: z.number(),
    }),
  }),
  error: z.object({ code: z.enum(["unavailable", "failed"]) }),
} as const;
export type AgentChatEventName = keyof typeof agentChatEventSchemas;
