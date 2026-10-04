import { sql } from "drizzle-orm";
import type { Db } from "./client";

export type WidgetTarget = {
  orgId: string;
  agentId: string;
  allowedOrigins: string[];
  /** Widget switched on and the agent active. */
  enabled: boolean;
};

/**
 * Resolves a public widget key to its tenant, before any tenant context exists. Goes
 * through the `closer_widget_lookup` SECURITY DEFINER function (migration 0006) rather than
 * the agents table, which RLS keeps closed without `app.org_id`.
 */
export async function lookupWidget(db: Db, publicKey: string): Promise<WidgetTarget | null> {
  const [row] = await db.execute<{
    org_id: string;
    agent_id: string;
    allowed_origins: string[];
    enabled: boolean;
  }>(sql`select * from closer_widget_lookup(${publicKey})`);
  return row
    ? {
        orgId: row.org_id,
        agentId: row.agent_id,
        allowedOrigins: row.allowed_origins,
        enabled: row.enabled,
      }
    : null;
}
