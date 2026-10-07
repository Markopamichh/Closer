import type { Db } from "@closer/db";
import { findMembership, withTenant } from "@closer/db";
import type { LeadDto } from "@closer/shared";
import { listLeadsQuerySchema, updateLeadSchema } from "@closer/shared";
import { Hono } from "hono";
import type { Auth } from "../auth";
import { AppError, notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { ANY_ROLE, requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

type LeadRow = {
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    score: number;
    status: LeadDto["status"];
    assignedTo: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  };
  assigneeName: string | null;
  conversationId: string | null;
};

function toDto({ lead, assigneeName, conversationId }: LeadRow): LeadDto {
  const interest = lead.metadata.interest;
  return {
    id: lead.id,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    interest: typeof interest === "string" ? interest : null,
    score: lead.score,
    status: lead.status,
    assignee:
      lead.assignedTo && assigneeName !== null ? { id: lead.assignedTo, name: assigneeName } : null,
    conversationId,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

/**
 * Leads captured by the agent, scoped to `:orgId`. Every member reads; owners and agents
 * (the sales team) move them through the pipeline and assign them.
 */
export function leadRoutes({ auth, db }: { auth: Auth; db: Db }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.get("/", requireRole(db, ...ANY_ROLE), validate("query", listLeadsQuerySchema), async (c) => {
    const { orgId } = c.get("membership");
    const filter = c.req.valid("query");
    const page = await withTenant(db, orgId, (repo) => repo.leads.list(filter));
    return c.json({
      leads: page.rows.map(toDto),
      total: page.total,
      limit: filter.limit,
      offset: filter.offset,
    });
  });

  r.patch(
    "/:leadId",
    requireRole(db, "owner", "agent"),
    validate("json", updateLeadSchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const leadId = resourceId(c.req.param("leadId"), "Lead");
      const patch = c.req.valid("json");
      // Assignment goes only to someone on this org's team.
      if (patch.assignedTo && !(await findMembership(db, orgId, patch.assignedTo))) {
        throw new AppError("validation_error", "Assignee is not a member of this organization");
      }
      const lead = await withTenant(db, orgId, async (repo) => {
        const updated = await repo.leads.update(leadId, patch);
        return updated ? repo.leads.get(leadId) : null;
      });
      if (!lead) throw notFound("Lead");
      return c.json({ lead: toDto(lead) });
    },
  );

  return r;
}
