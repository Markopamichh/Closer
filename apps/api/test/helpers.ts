import type { Db } from "@closer/db";
import { createDb } from "@closer/db";
import postgres from "postgres";
import { createApp } from "../src/app";
import { createAuth } from "../src/auth";
import { loadEnv } from "../src/env";
import { createLogger } from "../src/lib/logger";

export const WEB_ORIGIN = "http://localhost:3000";

export type TestContext = {
  app: ReturnType<typeof createApp>;
  /** Runtime connection as closer_app (RLS enforced) — what the API uses. */
  db: Db;
  /** Owner connection (bypasses RLS) — only for seeding and asserting ground truth. */
  sql: postgres.Sql;
  close: () => Promise<void>;
};

export function createTestContext(): TestContext {
  const env = loadEnv();
  const logger = createLogger(env);
  const { db, close: closeDb } = createDb(env.DATABASE_APP_URL, { max: 5 });
  const auth = createAuth({ db, env, logger });
  const app = createApp({ db, auth, logger });
  const ownerUrl = process.env.DATABASE_URL;
  if (!ownerUrl) throw new Error("DATABASE_URL missing");
  const sql = postgres(ownerUrl, { max: 2, onnotice: () => undefined });

  return {
    app,
    db,
    sql,
    close: async () => {
      await Promise.all([closeDb(), sql.end()]);
    },
  };
}

let seq = 0;
/** Unique per test run so files never collide on the unique email constraint. */
export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}-${(seq++).toString(36)}@closer.test`;

export type Client = {
  userId: string;
  email: string;
  request: (path: string, init?: { method?: string; body?: unknown }) => Promise<Response>;
};

/** A signed-in API client: signs up through Better Auth and replays the session cookie. */
export async function signUp(app: TestContext["app"], label: string): Promise<Client> {
  const email = uniqueEmail(label);
  const res = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: WEB_ORIGIN },
    body: JSON.stringify({ name: label, email, password: "correct-horse-battery" }),
  });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const { user } = (await res.json()) as { user: { id: string } };

  return {
    userId: user.id,
    email,
    request: async (path, init = {}) =>
      app.request(path, {
        method: init.method ?? "GET",
        headers: { cookie, origin: WEB_ORIGIN, "content-type": "application/json" },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      }),
  };
}

/** Unauthenticated request (no cookie). */
export const anonymous = async (
  app: TestContext["app"],
  path: string,
  method = "GET",
  body?: unknown,
) =>
  app.request(path, {
    method,
    headers: { origin: WEB_ORIGIN, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

export async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}
