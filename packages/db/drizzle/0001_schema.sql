CREATE TYPE "public"."call_status" AS ENUM('success', 'error');--> statement-breakpoint
CREATE TYPE "public"."conversation_channel" AS ENUM('widget', 'dashboard_test');--> statement-breakpoint
CREATE TYPE "public"."conversation_status" AS ENUM('open', 'handed_off', 'closed');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."inventory_status" AS ENUM('available', 'reserved', 'sold', 'archived');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'qualified', 'contacted', 'visit_scheduled', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."message_role" AS ENUM('user', 'assistant', 'human_agent', 'system');--> statement-breakpoint
CREATE TYPE "public"."org_role" AS ENUM('owner', 'agent', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."usage_event_type" AS ENUM('ai_message', 'embedding', 'document_ingested');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "org_role" DEFAULT 'viewer' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"inviter_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "org_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_unique" UNIQUE("org_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"system_prompt" text DEFAULT '' NOT NULL,
	"tone" text DEFAULT 'friendly' NOT NULL,
	"rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agents_id_org_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ai_traces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6) NOT NULL,
	"latency_ms" integer NOT NULL,
	"status" "call_status" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_traces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chunks_document_index_unique" UNIQUE("document_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"lead_id" uuid,
	"channel" "conversation_channel" NOT NULL,
	"visitor_id" text,
	"status" "conversation_status" DEFAULT 'open' NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_id_org_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"source_type" text NOT NULL,
	"storage_path" text,
	"mime_type" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_id_org_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"external_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_cents" bigint,
	"currency" text DEFAULT 'USD' NOT NULL,
	"status" "inventory_status" DEFAULT 'available' NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_items_org_external_id_unique" UNIQUE("org_id","external_id"),
	CONSTRAINT "inventory_items_currency_check" CHECK (char_length("inventory_items"."currency") = 3),
	CONSTRAINT "inventory_items_price_check" CHECK ("inventory_items"."price_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text,
	"email" text,
	"phone" text,
	"score" smallint DEFAULT 0 NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"assigned_to" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leads_id_org_unique" UNIQUE("id","org_id"),
	CONSTRAINT "leads_score_check" CHECK ("leads"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "message_role" NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_id_org_unique" UNIQUE("id","org_id")
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"tool_name" text NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"status" "call_status" NOT NULL,
	"error" text,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tool_calls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"type" "usage_event_type" NOT NULL,
	"quantity" bigint NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_quantity_check" CHECK ("usage_events"."quantity" >= 0)
);
--> statement-breakpoint
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_inviter_id_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_organization_id_organizations_id_fk" FOREIGN KEY ("active_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_traces" ADD CONSTRAINT "ai_traces_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_traces" ADD CONSTRAINT "ai_traces_conversation_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."conversations"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chunks" ADD CONSTRAINT "chunks_document_fk" FOREIGN KEY ("document_id","org_id") REFERENCES "public"."documents"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_agent_fk" FOREIGN KEY ("agent_id","org_id") REFERENCES "public"."agents"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_fk" FOREIGN KEY ("lead_id","org_id") REFERENCES "public"."leads"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fk" FOREIGN KEY ("conversation_id","org_id") REFERENCES "public"."conversations"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_message_fk" FOREIGN KEY ("message_id","org_id") REFERENCES "public"."messages"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "invitations_org_id_idx" ON "invitations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_inviter_id_idx" ON "invitations" USING btree ("inviter_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_active_org_id_idx" ON "sessions" USING btree ("active_organization_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "agents_org_id_idx" ON "agents" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_traces_org_created_idx" ON "ai_traces" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_traces_conversation_id_idx" ON "ai_traces" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "chunks_org_id_idx" ON "chunks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "chunks_embedding_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "conversations_org_last_message_idx" ON "conversations" USING btree ("org_id","last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_agent_id_idx" ON "conversations" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "conversations_lead_id_idx" ON "conversations" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "documents_org_id_idx" ON "documents" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "inventory_items_org_status_idx" ON "inventory_items" USING btree ("org_id","status");--> statement-breakpoint
CREATE INDEX "inventory_items_attributes_idx" ON "inventory_items" USING gin ("attributes");--> statement-breakpoint
CREATE INDEX "leads_org_status_idx" ON "leads" USING btree ("org_id","status","created_at");--> statement-breakpoint
CREATE INDEX "leads_assigned_to_idx" ON "leads" USING btree ("assigned_to");--> statement-breakpoint
CREATE INDEX "messages_conversation_created_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_org_id_idx" ON "messages" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "tool_calls_message_id_idx" ON "tool_calls" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "tool_calls_org_created_idx" ON "tool_calls" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "usage_events_org_type_created_idx" ON "usage_events" USING btree ("org_id","type","created_at");--> statement-breakpoint
CREATE POLICY "app_only" ON "accounts" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_only" ON "invitations" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_only" ON "memberships" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_only" ON "organizations" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_only" ON "sessions" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_only" ON "users" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "app_only" ON "verifications" AS PERMISSIVE FOR ALL TO "closer_app" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agents" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_traces" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "chunks" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversations" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "documents" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "inventory_items" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "leads" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "messages" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tool_calls" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "usage_events" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = closer_current_org_id()) WITH CHECK (org_id = closer_current_org_id());