import type { Db } from "@closer/db";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { Auth } from "./auth";
import type { BaseVariables } from "./lib/context";
import type { Logger } from "./lib/logger";
import { errorHandler } from "./middleware/error-handler";
import { requestContext } from "./middleware/request-context";
import { agentRoutes } from "./routes/agents";
import { healthRoutes } from "./routes/health";
import { meRoutes } from "./routes/me";
import { organizationRoutes } from "./routes/organizations";

export type AppDeps = { db: Db; auth: Auth; logger: Logger };

/** Builds the HTTP app from its dependencies, so tests can inject their own. */
export function createApp(deps: AppDeps) {
  const app = new Hono<{ Variables: BaseVariables }>();

  app.use("*", requestId({ limitLength: 64 }));
  app.use("*", requestContext(deps.logger));
  app.onError(errorHandler);
  app.notFound((c) =>
    c.json(
      { error: { code: "not_found", message: "Route not found", requestId: c.get("requestId") } },
      404,
    ),
  );

  app.route("/health", healthRoutes(deps));
  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));
  app.route("/api/me", meRoutes(deps));
  app.route("/api/organizations", organizationRoutes(deps));
  app.route("/api/organizations/:orgId/agents", agentRoutes(deps));

  return app;
}

export type App = ReturnType<typeof createApp>;
