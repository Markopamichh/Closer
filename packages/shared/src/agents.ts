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

/**
 * USD per 1M tokens, standard tier, from the official OpenAI pricing page (checked
 * 2026-10-01). One table for the API's cost accounting and the dashboard's model picker.
 */
export const AGENT_MODEL_PRICES: Record<
  AgentModel,
  { input: number; cachedInput: number; output: number }
> = {
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
};

/** Most origins one widget may be embedded on. */
export const MAX_WIDGET_ORIGINS = 10;

/**
 * An origin allowed to frame the widget, normalized to `scheme://host[:port]`. A path,
 * query or wildcard is rejected rather than silently dropped: the owner should see that
 * "https://shop.com/cars" means the whole site. Goes into a CSP header, so nothing but a
 * parsed http(s) origin can get through.
 */
export const widgetOriginSchema = z
  .string()
  .trim()
  .max(200)
  .transform((value, ctx) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      ctx.addIssue({ code: "custom", message: "Not a valid URL" });
      return z.NEVER;
    }
    const bare = url.pathname === "/" && !url.search && !url.hash && !url.username;
    // URL accepts "*" in hosts, and in CSP "https://*.shop.com" is a wildcard: refuse it.
    const plainHost = /^[a-z0-9.-]+$|^\[[0-9a-f:.]+\]$/.test(url.hostname);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !bare || !plainHost) {
      ctx.addIssue({ code: "custom", message: "Use only the site origin, e.g. https://shop.com" });
      return z.NEVER;
    }
    return url.origin;
  });

/** An IANA time zone the runtime knows, e.g. "America/Argentina/Buenos_Aires". */
export const timezoneSchema = z
  .string()
  .max(64)
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Unknown time zone" },
  );

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
    timezone: timezoneSchema,
    widgetEnabled: z.boolean(),
    allowedOrigins: z
      .array(widgetOriginSchema)
      .max(MAX_WIDGET_ORIGINS)
      .transform((origins) => [...new Set(origins)]),
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
  timezone: z.string(),
  widgetEnabled: z.boolean(),
  /** Public by design: it ends up in the business's page source. */
  publicKey: z.string(),
  allowedOrigins: z.array(z.string()),
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

/** Public key format (see migration 0006): anything else is a 404 without a lookup. */
export const widgetPublicKeySchema = z.string().regex(/^pk_[0-9a-f]{32}$/);

/** What the embed page needs before the first message. Nothing here is private. */
export const widgetConfigSchema = z.object({
  agentName: z.string(),
  businessName: z.string(),
  /** For the embed page's CSP frame-ancestors (the same list the owner saved). */
  allowedOrigins: z.array(z.string()),
});
export type WidgetConfig = z.infer<typeof widgetConfigSchema>;

/**
 * A widget visitor's message. `visitorId` is random per browser (kept by the widget) and
 * must match to continue a conversation, so one visitor can never read another's chat.
 */
export const widgetChatRequestSchema = agentChatRequestSchema.extend({ visitorId: z.uuid() });
export type WidgetChatRequest = z.infer<typeof widgetChatRequestSchema>;

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
