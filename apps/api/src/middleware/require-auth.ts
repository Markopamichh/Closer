import { createMiddleware } from "hono/factory";
import type { Auth, AuthSession } from "../auth";
import type { BaseVariables } from "../lib/context";
import { unauthorized } from "../lib/errors";

export type AuthVariables = BaseVariables & {
  user: AuthSession["user"];
  session: AuthSession["session"];
};

export const requireAuth = (auth: Auth) =>
  createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!result) throw unauthorized();
    c.set("user", result.user);
    c.set("session", result.session);
    c.set("logger", c.get("logger").child({ userId: result.user.id }));
    await next();
  });
