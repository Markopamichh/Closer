import { z } from "zod";

export const CONVERSATION_CHANNELS = ["widget", "dashboard_test"] as const;
export const CONVERSATION_STATUSES = ["open", "handed_off", "closed"] as const;
export const MESSAGE_ROLES = ["user", "assistant", "human_agent", "system"] as const;

export const listConversationsQuerySchema = z.object({
  agentId: z.uuid().optional(),
  channel: z.enum(CONVERSATION_CHANNELS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});
export type ListConversationsQuery = z.infer<typeof listConversationsQuerySchema>;

export const conversationSummarySchema = z.object({
  id: z.uuid(),
  agent: z.object({ id: z.uuid(), name: z.string() }),
  channel: z.enum(CONVERSATION_CHANNELS),
  status: z.enum(CONVERSATION_STATUSES),
  messageCount: z.number().int(),
  /** First characters of the latest message, or null before the first one. */
  lastMessagePreview: z.string().nullable(),
  lastMessageAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ConversationSummaryDto = z.infer<typeof conversationSummarySchema>;

export const conversationPageSchema = z.object({
  conversations: z.array(conversationSummarySchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
});
export type ConversationPage = z.infer<typeof conversationPageSchema>;

/**
 * What the agent looked up. The tool output is left out on purpose: it can be large, and
 * the reply that used it is already in the thread.
 */
export const toolCallSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  input: z.unknown(),
  status: z.enum(["success", "error"]),
  error: z.string().nullable(),
  latencyMs: z.number().int(),
});
export type ToolCallDto = z.infer<typeof toolCallSchema>;

export const conversationMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(MESSAGE_ROLES),
  content: z.string(),
  toolCalls: z.array(toolCallSchema),
  /** Model cost of producing this reply; null for non-agent messages and older replies. */
  costUsd: z.number().nullable(),
  createdAt: z.string(),
});
export type ConversationMessageDto = z.infer<typeof conversationMessageSchema>;

export const conversationDetailSchema = z.object({
  conversation: conversationSummarySchema.extend({
    /** All model calls on this conversation, failed ones included. */
    costUsd: z.number(),
    messages: z.array(conversationMessageSchema),
  }),
});
export type ConversationDetail = z.infer<typeof conversationDetailSchema>;
