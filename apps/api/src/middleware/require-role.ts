import type { Db } from "@closer/db";
import { findMembership } from "@closer/db";
import type { OrgRole } from "@closer/shared";
import { orgIdParamSchema } from "@closer/shared";
import { createMiddleware } from "hono/factory";
import { forbidden, notFound } from "../lib/errors";
import type { AuthVariables } from "./require-auth";

export type Membership = { orgId: string; userId: string; role: OrgRole };
export type MembershipVariables = { membership: Membership };

/**
 * Resolves the caller's membership in `:orgId` and checks their role.
 * Must run after `requireAuth`.
 *
 * - Not a member (or org doesn't exist, or malformed id) → 404, so callers can't probe
 *   which organizations exist.
 * - Member without an allowed role → 403.
 *
 * Handlers must use `c.get("membership").orgId`, never an org id from the body.
 */
export const requireRole = (db: Db, ...allowed: [OrgRole, ...OrgRole[]]) =>
  createMiddleware<{ Variables: AuthVariables & MembershipVariables }>(async (c, next) => {
    const parsed = orgIdParamSchema.safeParse({ orgId: c.req.param("orgId") });
    if (!parsed.success) throw notFound("Organization");

    const row = await findMembership(db, parsed.data.orgId, c.get("user").id);
    if (!row) throw notFound("Organization");
    if (!allowed.includes(row.role)) throw forbidden();

    c.set("membership", row);
    await next();
  });

/** Every role; for routes any member may call. */
export const ANY_ROLE: [OrgRole, ...OrgRole[]] = ["owner", "agent", "viewer"];
