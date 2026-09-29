import { z } from "zod";

export const AGENT_TONES = ["friendly", "professional", "concise", "enthusiastic"] as const;

export const createAgentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  systemPrompt: z.string().max(20_000).default(""),
  tone: z.enum(AGENT_TONES).default("friendly"),
  rules: z.array(z.string().trim().min(1).max(500)).max(50).default([]),
  model: z.string().trim().min(1).max(100),
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
    model: z.string().trim().min(1).max(100),
    isActive: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "At least one field is required" });
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;
