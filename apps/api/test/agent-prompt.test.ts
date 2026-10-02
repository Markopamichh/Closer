import { describe, expect, it } from "vitest";
import { buildInstructions } from "../src/agent/prompt";

const agent = { name: "Sofía", tone: "friendly", rules: [], systemPrompt: "" };

describe("buildInstructions", () => {
  it("is deterministic, so the prompt cache can reuse it", () => {
    expect(buildInstructions(agent, "Demo Motors")).toBe(buildInstructions(agent, "Demo Motors"));
  });

  it("starts with the same policy for every business (shared cacheable prefix)", () => {
    const a = buildInstructions(agent, "Demo Motors");
    const b = buildInstructions({ ...agent, name: "Max", tone: "formal" }, "Beta Realty");
    const shared = a.slice(0, a.indexOf("# This business"));
    expect(shared.length).toBeGreaterThan(500);
    expect(b.startsWith(shared)).toBe(true);
    expect(shared).not.toContain("Demo Motors");
  });

  it("adds the business identity, owner rules and notes after the shared policy", () => {
    const prompt = buildInstructions(
      {
        ...agent,
        rules: ["  Mention free test drives ", ""],
        systemPrompt: "We close on Sundays.",
      },
      "Demo Motors",
    );
    const businessAt = prompt.indexOf("# This business");
    expect(prompt.indexOf('You are "Sofía", the assistant of Demo Motors')).toBeGreaterThan(
      businessAt,
    );
    expect(prompt).toContain("<owner_rules>\n- Mention free test drives\n</owner_rules>");
    expect(prompt).toContain("<owner_notes>\nWe close on Sundays.\n</owner_notes>");
  });

  it("omits empty owner sections", () => {
    const prompt = buildInstructions(agent, "Demo Motors");
    expect(prompt).not.toContain("<owner_rules>");
    expect(prompt).not.toContain("<owner_notes>");
  });
});
