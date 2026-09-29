import pino from "pino";
import type { Env } from "../env";

export function createLogger(env: Pick<Env, "LOG_LEVEL" | "NODE_ENV">) {
  return pino({
    level: env.LOG_LEVEL,
    base: { service: "closer-api" },
    redact: {
      paths: ["req.headers.cookie", "req.headers.authorization", "*.password", "*.token"],
      censor: "[redacted]",
    },
    // Human-readable output locally; structured JSON everywhere else.
    ...(env.NODE_ENV === "development"
      ? { transport: { target: "pino-pretty", options: { colorize: true } } }
      : {}),
  });
}

export type Logger = ReturnType<typeof createLogger>;
