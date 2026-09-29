import { Hono } from "hono";
import { requestId } from "hono/request-id";
import pino from "pino";
import { describe, expect, it } from "vitest";
import type { BaseVariables } from "../src/lib/context";
import { AppError } from "../src/lib/errors";
import { errorHandler } from "../src/middleware/error-handler";
import { requestContext } from "../src/middleware/request-context";

function appThrowing(err: unknown) {
  const app = new Hono<{ Variables: BaseVariables }>();
  app.use("*", requestId());
  app.use("*", requestContext(pino({ level: "silent" })));
  app.onError(errorHandler);
  app.get("/", () => {
    throw err;
  });
  return app;
}

type Body = { error: { code: string; message: string; requestId: string; details?: unknown } };

describe("error handler", () => {
  it("never leaks internal error details on a 500", async () => {
    const res = await appThrowing(
      new Error("connect ECONNREFUSED postgres://user:secret@db"),
    ).request("/");
    const body = (await res.json()) as Body;

    expect(res.status).toBe(500);
    expect(body.error).toMatchObject({ code: "internal_error", message: "Internal server error" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("maps AppError to its status, code and details", async () => {
    const res = await appThrowing(
      new AppError("validation_error", "Invalid request", [{ path: "name" }]),
    ).request("/");
    const body = (await res.json()) as Body;

    expect(res.status).toBe(422);
    expect(body.error).toMatchObject({ code: "validation_error", details: [{ path: "name" }] });
  });

  it("includes the request id in the body and echoes it in the header", async () => {
    const res = await appThrowing(new AppError("forbidden", "nope")).request("/", {
      headers: { "x-request-id": "trace-abc-123" },
    });
    const body = (await res.json()) as Body;

    expect(res.headers.get("x-request-id")).toBe("trace-abc-123");
    expect(body.error.requestId).toBe("trace-abc-123");
  });

  it("replaces a malformed client request id instead of reflecting it", async () => {
    const res = await appThrowing(new AppError("forbidden", "nope")).request("/", {
      headers: { "x-request-id": "<script>alert(1)</script>" },
    });
    expect(res.headers.get("x-request-id")).not.toContain("<script>");
  });
});
