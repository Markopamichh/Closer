import { randomBytes } from "node:crypto";
import type { Db } from "@closer/db";
import { listOrganizationsForUser } from "@closer/db";
import { createOrganizationSchema, inviteMemberSchema } from "@closer/shared";
import { Hono } from "hono";
import type { Auth } from "../auth";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";
import { requireRole } from "../middleware/require-role";
import { validate } from "../middleware/validate";

/** URL-safe slug with a random suffix so two orgs with the same name never collide. */
function toSlug(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomBytes(3).toString("hex")}`;
}

export function organizationRoutes({ auth, db }: { auth: Auth; db: Db }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  // Auth is applied per route, not with `use("*")`: that wildcard would also match the
  // nested /:orgId/agents routes mounted separately and authenticate them twice.
  const authed = requireAuth(auth);

  r.get("/", authed, async (c) => {
    const organizations = await listOrganizationsForUser(db, c.get("user").id);
    return c.json({ organizations });
  });

  r.post("/", authed, validate("json", createOrganizationSchema), async (c) => {
    const { name } = c.req.valid("json");
    const org = await auth.api.createOrganization({
      body: { name, slug: toSlug(name) },
      headers: c.req.raw.headers,
    });
    return c.json({ id: org.id, name: org.name, slug: org.slug, role: "owner" as const }, 201);
  });

  // requireRole runs before body validation: a non-member gets 404 regardless of the body.
  r.post(
    "/:orgId/invitations",
    authed,
    requireRole(db, "owner"),
    validate("json", inviteMemberSchema),
    async (c) => {
      const { orgId } = c.get("membership");
      const { email, role } = c.req.valid("json");
      const invitation = await auth.api.createInvitation({
        body: { email, role, organizationId: orgId },
        headers: c.req.raw.headers,
      });
      return c.json(
        {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          status: invitation.status,
          expiresAt: invitation.expiresAt,
        },
        201,
      );
    },
  );

  return r;
}
