CREATE TYPE "public"."visit_status" AS ENUM('requested', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TABLE "visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"inventory_item_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"status" "visit_status" DEFAULT 'requested' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "widget_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "public_key" text DEFAULT ('pk_' || replace(gen_random_uuid()::text, '-', '')) NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "allowed_origins" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Must exist before visits_inventory_item_fk references it (drizzle-kit orders it last).
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_id_org_unique" UNIQUE("id","org_id");--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_lead_fk" FOREIGN KEY ("lead_id","org_id") REFERENCES "public"."leads"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visits" ADD CONSTRAINT "visits_inventory_item_fk" FOREIGN KEY ("inventory_item_id","org_id") REFERENCES "public"."inventory_items"("id","org_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visits_org_scheduled_idx" ON "visits" USING btree ("org_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "visits_lead_id_idx" ON "visits" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "visits_inventory_item_id_idx" ON "visits" USING btree ("inventory_item_id");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_public_key_unique" UNIQUE("public_key");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "visits" AS PERMISSIVE FOR ALL TO "closer_app" USING (org_id = (select closer_current_org_id())) WITH CHECK (org_id = (select closer_current_org_id()));--> statement-breakpoint

-- Public widget lookup. A widget request carries only its public key, so the org is not
-- known yet and RLS (keyed on app.org_id) hides every agent. This function, owned by the
-- migration role, answers exactly one question: which org/agent owns this key, and may it
-- be framed from where? Everything after that runs under withTenant as usual.
CREATE OR REPLACE FUNCTION closer_widget_lookup(p_public_key text)
  RETURNS TABLE (org_id uuid, agent_id uuid, allowed_origins text[], enabled boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = ''
  AS $$
    SELECT a.org_id, a.id, a.allowed_origins, a.widget_enabled AND a.is_active
    FROM public.agents a
    WHERE a.public_key = p_public_key
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION closer_widget_lookup(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION closer_widget_lookup(text) TO closer_app;
