import type { Db } from "@closer/db";
import { isForeignKeyViolation, withTenant } from "@closer/db";
import { createAgentSchema, updateAgentSchema } from "@closer/shared";
import { Hono } from "hono";
import type { Auth } from "../auth";
import { AppError, notFound } from "../lib/errors";
import { resourceId } from "../lib/params";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { ANY_ROLE, requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

/**
 * AI sales agent configuration, scoped to `:orgId`.
 * Any member can read; only owners can change how the agent talks to customers.
 * All data access goes through `withTenant` (repository filter + RLS).
 */
export function agentRoutes({ auth, db }: { auth: Auth; db: Db }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.get("/", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const agents = await withTenant(db, orgId, (repo) => repo.agents.list());
    return c.json({ agents });
  });

  r.post("/", requireRole(db, "owner"), validate("json", createAgentSchema), async (c) => {
    const { orgId } = c.get("membership");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.create(c.req.valid("json")));
    return c.json({ agent }, 201);
  });

  r.get("/:agentId", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const agentId = resourceId(c.req.param("agentId"), "Agent");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.get(agentId));
    if (!agent) throw notFound("Agent");
    return c.json({ agent });
  });

  r.patch("/:agentId", requireRole(db, "owner"), validate("json", updateAgentSchema), async (c) => {
    const { orgId } = c.get("membership");
    const agentId = resourceId(c.req.param("agentId"), "Agent");
    const patch = c.req.valid("json");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.update(agentId, patch));
    if (!agent) throw notFound("Agent");
    return c.json({ agent });
  });

  r.delete("/:agentId", requireRole(db, "owner"), async (c) => {
    const { orgId } = c.get("membership");
    const agentId = resourceId(c.req.param("agentId"), "Agent");
    try {
      const deleted = await withTenant(db, orgId, (repo) => repo.agents.delete(agentId));
      if (!deleted) throw notFound("Agent");
    } catch (err) {
      // conversations_agent_fk is ON DELETE RESTRICT: history must not disappear.
      if (isForeignKeyViolation(err)) {
        throw new AppError("conflict", "Agent has conversations; deactivate it instead");
      }
      throw err;
    }
    return c.body(null, 204);
  });

  return r;
}
