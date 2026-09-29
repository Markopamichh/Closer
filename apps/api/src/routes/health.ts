import type { Db } from "@closer/db";
import { pingDb } from "@closer/db";
import { Hono } from "hono";
import type { BaseVariables } from "../lib/context";

export function healthRoutes({ db }: { db: Db }) {
  const r = new Hono<{ Variables: BaseVariables }>();

  // Liveness + readiness in one: the API is useless without its database.
  r.get("/", async (c) => {
    try {
      await pingDb(db);
      return c.json({ status: "ok" });
    } catch (err) {
      c.get("logger").error({ err }, "health check: database unreachable");
      return c.json({ status: "degraded", checks: { database: "unreachable" } }, 503);
    }
  });

  return r;
}
