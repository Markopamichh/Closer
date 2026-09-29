import { pgEnum } from "drizzle-orm/pg-core";

export const orgRoleEnum = pgEnum("org_role", ["owner", "agent", "viewer"]);

export const inventoryStatusEnum = pgEnum("inventory_status", [
  "available",
  "reserved",
  "sold",
  "archived",
]);

export const documentStatusEnum = pgEnum("document_status", [
  "pending",
  "processing",
  "ready",
  "failed",
]);

export const conversationChannelEnum = pgEnum("conversation_channel", ["widget", "dashboard_test"]);

export const conversationStatusEnum = pgEnum("conversation_status", [
  "open",
  "handed_off",
  "closed",
]);

export const messageRoleEnum = pgEnum("message_role", [
  "user",
  "assistant",
  "human_agent",
  "system",
]);

export const leadStatusEnum = pgEnum("lead_status", [
  "new",
  "qualified",
  "contacted",
  "visit_scheduled",
  "won",
  "lost",
]);

export const callStatusEnum = pgEnum("call_status", ["success", "error"]);

export const usageEventTypeEnum = pgEnum("usage_event_type", [
  "ai_message",
  "embedding",
  "document_ingested",
]);
