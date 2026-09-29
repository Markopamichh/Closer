import { Hono } from "hono";
import type { Auth } from "../auth";
import type { AuthVariables } from "../middleware/require-auth";
import { requireAuth } from "../middleware/require-auth";

export function meRoutes({ auth }: { auth: Auth }) {
  const r = new Hono<{ Variables: AuthVariables }>();

  r.get("/", requireAuth(auth), (c) => {
    const { id, name, email, emailVerified, image } = c.get("user");
    return c.json({
      user: { id, name, email, emailVerified, image: image ?? null },
      activeOrganizationId: c.get("session").activeOrganizationId ?? null,
    });
  });

  return r;
}
