import { createDb } from "@closer/db";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { createAuth } from "./auth";
import { loadEnv } from "./env";
import { createLogger } from "./lib/logger";

const env = loadEnv();
const logger = createLogger(env);
const { db, close } = createDb(env.DATABASE_APP_URL);
const auth = createAuth({ db, env, logger });
const app = createApp({ db, auth, logger });

const server = serve({ fetch: app.fetch, port: env.API_PORT }, (info) => {
  logger.info({ port: info.port }, "api listening");
});

// Drain in-flight requests and close the pool on deploys/restarts.
function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void close().finally(() => process.exit(0));
  });
}
process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
