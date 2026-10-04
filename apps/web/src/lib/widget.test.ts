import { describe, expect, it } from "vitest";
import { frameAncestors } from "./widget";

describe("frameAncestors", () => {
  it("allows 'self' plus the business's origins", () => {
    expect(frameAncestors(["https://shop.com", "http://localhost:8080"])).toBe(
      "frame-ancestors 'self' https://shop.com http://localhost:8080",
    );
  });

  it("with no origins, only the dashboard can frame it", () => {
    expect(frameAncestors([])).toBe("frame-ancestors 'self'");
  });

  it.each([
    "https://*.shop.com",
    "https://shop.com; script-src *",
    "https://shop.com 'unsafe-inline'",
    "javascript:alert(1)",
    "https://shop.com/path",
    "*",
  ])("drops anything that is not a plain origin: %s", (bad) => {
    expect(frameAncestors(["https://ok.com", bad])).toBe("frame-ancestors 'self' https://ok.com");
  });
});
