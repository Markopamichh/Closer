import type { Db } from "@closer/db";
import { isForeignKeyViolation, withTenant } from "@closer/db";
import type { AgentDto } from "@closer/shared";
import { AGENT_MODELS, AGENT_TONES, createAgentSchema, updateAgentSchema } from "@closer/shared";
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
type AgentRow = Omit<AgentDto, "tone" | "model" | "createdAt" | "updatedAt"> & {
  tone: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
};

/** Public shape. Tone and model are validated on write; a stray value is a broken invariant. */
function toDto(agent: AgentRow): AgentDto {
  const tone = AGENT_TONES.find((t) => t === agent.tone);
  const model = AGENT_MODELS.find((m) => m === agent.model);
  if (!tone || !model) throw new Error(`Agent ${agent.id} has an unknown tone or model`);
  return {
    id: agent.id,
    name: agent.name,
    systemPrompt: agent.systemPrompt,
    tone,
    rules: agent.rules,
    model,
    isActive: agent.isActive,
    timezone: agent.timezone,
    widgetEnabled: agent.widgetEnabled,
    publicKey: agent.publicKey,
    allowedOrigins: agent.allowedOrigins,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export function agentRoutes({ auth, db }: { auth: Auth; db: Db }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.use("*", requireAuth(auth));

  r.get("/", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const agents = await withTenant(db, orgId, (repo) => repo.agents.list());
    return c.json({ agents: agents.map(toDto) });
  });

  r.post("/", requireRole(db, "owner"), validate("json", createAgentSchema), async (c) => {
    const { orgId } = c.get("membership");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.create(c.req.valid("json")));
    return c.json({ agent: toDto(agent) }, 201);
  });

  r.get("/:agentId", requireRole(db, ...ANY_ROLE), async (c) => {
    const { orgId } = c.get("membership");
    const agentId = resourceId(c.req.param("agentId"), "Agent");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.get(agentId));
    if (!agent) throw notFound("Agent");
    return c.json({ agent: toDto(agent) });
  });

  r.patch("/:agentId", requireRole(db, "owner"), validate("json", updateAgentSchema), async (c) => {
    const { orgId } = c.get("membership");
    const agentId = resourceId(c.req.param("agentId"), "Agent");
    const patch = c.req.valid("json");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.update(agentId, patch));
    if (!agent) throw notFound("Agent");
    return c.json({ agent: toDto(agent) });
  });

  // Invalidates every embed of the old key at once (e.g. after it was pasted somewhere wrong).
  r.post("/:agentId/widget/rotate-key", requireRole(db, "owner"), async (c) => {
    const { orgId } = c.get("membership");
    const agentId = resourceId(c.req.param("agentId"), "Agent");
    const agent = await withTenant(db, orgId, (repo) => repo.agents.rotatePublicKey(agentId));
    if (!agent) throw notFound("Agent");
    return c.json({ agent: toDto(agent) });
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
