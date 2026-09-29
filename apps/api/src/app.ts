import type { Db } from "@closer/db";
import { Hono } from "hono";
import type { Auth } from "./auth";
import type { Logger } from "./lib/logger";
import { createErrorHandler } from "./middleware/error-handler";
import { organizationRoutes } from "./routes/organizations";

export type AppDeps = { db: Db; auth: Auth; logger: Logger };

/** Builds the HTTP app from its dependencies, so tests can inject their own. */
export function createApp(deps: AppDeps) {
  const app = new Hono();

  app.onError(createErrorHandler(deps.logger));

  app.get("/health", (c) => c.json({ status: "ok" }));

  app.on(["GET", "POST"], "/api/auth/*", (c) => deps.auth.handler(c.req.raw));
  app.route("/api/organizations", organizationRoutes(deps));

  return app;
}
