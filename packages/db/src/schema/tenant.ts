import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { id, tenantIsolationPolicy, timestamps } from "./_shared";
import { organizations, users } from "./auth";
import {
  callStatusEnum,
  conversationChannelEnum,
  conversationStatusEnum,
  documentStatusEnum,
  inventoryStatusEnum,
  leadStatusEnum,
  messageRoleEnum,
  usageEventTypeEnum,
} from "./enums";

// Every table in this file is tenant data:
// - org_id NOT NULL, FK to organizations (cascade), indexed (leading column of an index).
// - RLS policy `tenant_isolation`.
// - Parent/child relations use composite FKs on (id, org_id) so a child can never point
//   to a parent that belongs to another org — enforced by Postgres, not by app code.

const orgId = () =>
  uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

export const agents = pgTable(
  "agents",
  {
    id: id(),
    orgId: orgId(),
    name: text().notNull(),
    systemPrompt: text().notNull().default(""),
    tone: text().notNull().default("friendly"),
    rules: jsonb().$type<string[]>().notNull().default([]),
    model: text().notNull(),
    isActive: boolean().notNull().default(true),
    ...timestamps,
  },
  (t) => [
    unique("agents_id_org_unique").on(t.id, t.orgId),
    index("agents_org_id_idx").on(t.orgId, t.createdAt),
    tenantIsolationPolicy(),
  ],
);

export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: id(),
    orgId: orgId(),
    /** Business-defined identifier (SKU, VIN, listing code). Used for CSV upserts. */
    externalId: text(),
    /** Vertical-specific item type, e.g. "vehicle" or "property". */
    kind: text().notNull(),
    title: text().notNull(),
    description: text(),
    /** Money as integer minor units to avoid floating point errors. */
    priceCents: bigint({ mode: "number" }),
    currency: text().notNull().default("USD"),
    status: inventoryStatusEnum().notNull().default("available"),
    /** Vertical-specific fields (mileage, bedrooms, ...) — validated per kind in the API. */
    attributes: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique("inventory_items_org_external_id_unique").on(t.orgId, t.externalId),
    index("inventory_items_org_status_idx").on(t.orgId, t.status),
    index("inventory_items_attributes_idx").using("gin", t.attributes),
    check("inventory_items_currency_check", sql`char_length(${t.currency}) = 3`),
    check("inventory_items_price_check", sql`${t.priceCents} >= 0`),
    tenantIsolationPolicy(),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    orgId: orgId(),
    title: text().notNull(),
    sourceType: text().notNull(),
    storagePath: text(),
    mimeType: text(),
    status: documentStatusEnum().notNull().default("pending"),
    error: text(),
    ...timestamps,
  },
  (t) => [
    unique("documents_id_org_unique").on(t.id, t.orgId),
    index("documents_org_id_idx").on(t.orgId, t.createdAt),
    tenantIsolationPolicy(),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: id(),
    orgId: orgId(),
    documentId: uuid().notNull(),
    chunkIndex: integer().notNull(),
    content: text().notNull(),
    tokenCount: integer().notNull(),
    embedding: vector({ dimensions: 1024 }).notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "chunks_document_fk",
      columns: [t.documentId, t.orgId],
      foreignColumns: [documents.id, documents.orgId],
    }).onDelete("cascade"),
    unique("chunks_document_index_unique").on(t.documentId, t.chunkIndex),
    index("chunks_org_id_idx").on(t.orgId),
    index("chunks_embedding_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    tenantIsolationPolicy(),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    orgId: orgId(),
    name: text(),
    email: text(),
    phone: text(),
    score: smallint().notNull().default(0),
    status: leadStatusEnum().notNull().default("new"),
    /** Team member responsible for follow-up. Membership in the org is checked by the API. */
    assignedTo: uuid().references(() => users.id, { onDelete: "set null" }),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique("leads_id_org_unique").on(t.id, t.orgId),
    index("leads_org_status_idx").on(t.orgId, t.status, t.createdAt),
    index("leads_assigned_to_idx").on(t.assignedTo),
    check("leads_score_check", sql`${t.score} between 0 and 100`),
    tenantIsolationPolicy(),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    orgId: orgId(),
    agentId: uuid().notNull(),
    leadId: uuid(),
    channel: conversationChannelEnum().notNull(),
    /** Anonymous widget visitor id (cookie/localStorage), not a user account. */
    visitorId: text(),
    status: conversationStatusEnum().notNull().default("open"),
    lastMessageAt: timestamp({ withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    unique("conversations_id_org_unique").on(t.id, t.orgId),
    // Agents are deactivated, not deleted, once they have conversation history.
    foreignKey({
      name: "conversations_agent_fk",
      columns: [t.agentId, t.orgId],
      foreignColumns: [agents.id, agents.orgId],
    }).onDelete("restrict"),
    foreignKey({
      name: "conversations_lead_fk",
      columns: [t.leadId, t.orgId],
      foreignColumns: [leads.id, leads.orgId],
    }).onDelete("restrict"),
    index("conversations_org_last_message_idx").on(t.orgId, t.lastMessageAt),
    index("conversations_agent_id_idx").on(t.agentId),
    index("conversations_lead_id_idx").on(t.leadId),
    tenantIsolationPolicy(),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    orgId: orgId(),
    conversationId: uuid().notNull(),
    role: messageRoleEnum().notNull(),
    content: text().notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    unique("messages_id_org_unique").on(t.id, t.orgId),
    foreignKey({
      name: "messages_conversation_fk",
      columns: [t.conversationId, t.orgId],
      foreignColumns: [conversations.id, conversations.orgId],
    }).onDelete("cascade"),
    index("messages_conversation_created_idx").on(t.conversationId, t.createdAt),
    index("messages_org_id_idx").on(t.orgId),
    tenantIsolationPolicy(),
  ],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: id(),
    orgId: orgId(),
    messageId: uuid().notNull(),
    toolName: text().notNull(),
    input: jsonb().$type<unknown>().notNull(),
    output: jsonb().$type<unknown>(),
    status: callStatusEnum().notNull(),
    error: text(),
    latencyMs: integer().notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "tool_calls_message_fk",
      columns: [t.messageId, t.orgId],
      foreignColumns: [messages.id, messages.orgId],
    }).onDelete("cascade"),
    index("tool_calls_message_id_idx").on(t.messageId),
    index("tool_calls_org_created_idx").on(t.orgId, t.createdAt),
    tenantIsolationPolicy(),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    orgId: orgId(),
    type: usageEventTypeEnum().notNull(),
    quantity: bigint({ mode: "number" }).notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (t) => [
    index("usage_events_org_type_created_idx").on(t.orgId, t.type, t.createdAt),
    check("usage_events_quantity_check", sql`${t.quantity} >= 0`),
    tenantIsolationPolicy(),
  ],
);

export const aiTraces = pgTable(
  "ai_traces",
  {
    id: id(),
    orgId: orgId(),
    conversationId: uuid(),
    model: text().notNull(),
    inputTokens: integer().notNull(),
    outputTokens: integer().notNull(),
    /** Prompt caching tokens are billed differently, so they are tracked separately. */
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    costUsd: numeric({ precision: 12, scale: 6 }).notNull(),
    latencyMs: integer().notNull(),
    status: callStatusEnum().notNull(),
    error: text(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "ai_traces_conversation_fk",
      columns: [t.conversationId, t.orgId],
      foreignColumns: [conversations.id, conversations.orgId],
    }).onDelete("cascade"),
    index("ai_traces_org_created_idx").on(t.orgId, t.createdAt),
    index("ai_traces_conversation_id_idx").on(t.conversationId),
    tenantIsolationPolicy(),
  ],
);
