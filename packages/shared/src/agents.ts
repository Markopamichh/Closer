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
