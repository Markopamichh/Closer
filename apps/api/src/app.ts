import type { EmbeddingProvider, LlmClient } from "@closer/ai";
import type { Db } from "@closer/db";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import type { Auth } from "./auth";
import type { BaseVariables } from "./lib/context";
import type { Logger } from "./lib/logger";
import type { RateLimiter } from "./lib/rate-limit";
import type { FileStorage } from "./lib/storage";
import { errorHandler } from "./middleware/error-handler";
import { requestContext } from "./middleware/request-context";
import type { DocumentQueue } from "./queue/documents";
import { agentChatRoutes } from "./routes/agent-chat";
import { agentRoutes } from "./routes/agents";
import { conversationRoutes } from "./routes/conversations";
import { documentRoutes } from "./routes/documents";
import { healthRoutes } from "./routes/health";
import { inventoryRoutes } from "./routes/inventory";
import { meRoutes } from "./routes/me";
import { organizationRoutes } from "./routes/organizations";
import { widgetRoutes } from "./routes/widget";

export type AppDeps = {
  db: Db;
  auth: Auth;
  logger: Logger;
  storage: FileStorage;
  documentQueue: DocumentQueue;
  embedder: EmbeddingProvider;
  /** Per-org limit on paid query embeddings. */
  searchLimiter: RateLimiter;
  /** Null when no model provider is configured. */
  llm: LlmClient | null;
  /** Per-org limit on agent messages (each one costs model tokens). */
  chatLimiter: RateLimiter;
  /** Per-org daily cap on agent messages, test chat and widget combined: the spend ceiling. */
  dailyChatLimiter: RateLimiter;
  /** Per-visitor limit on the public widget, so one visitor can't use up the org's quota. */
  visitorChatLimiter: RateLimiter;
};

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
  app.route("/api/organizations/:orgId/agents/:agentId/test-chat", agentChatRoutes(deps));
  app.route("/api/organizations/:orgId/agents", agentRoutes(deps));
  app.route("/api/organizations/:orgId/conversations", conversationRoutes(deps));
  app.route("/api/organizations/:orgId/inventory", inventoryRoutes(deps));
  app.route("/api/organizations/:orgId/documents", documentRoutes(deps));
  app.route("/api/public/widget", widgetRoutes(deps));

  return app;
}

export type App = ReturnType<typeof createApp>;
