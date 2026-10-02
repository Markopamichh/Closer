import { describe, expect, it } from "vitest";
import { costUsd } from "../src/llm/pricing";

const usage = { inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 };

describe("costUsd", () => {
  it("prices input, cached input and output separately", () => {
    expect(costUsd("gpt-5-nano", usage)).toBeCloseTo(0.05);
    expect(costUsd("gpt-5-nano", { ...usage, cachedInputTokens: 1_000_000 })).toBeCloseTo(0.005);
    expect(
      costUsd("gpt-5-nano", { ...usage, inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBeCloseTo(0.4);
  });

  it("matches the real smoke-test turn (1592 in, 1280 cached, 126 out)", () => {
    const cost = costUsd("gpt-5-nano", {
      inputTokens: 1592,
      cachedInputTokens: 1280,
      outputTokens: 126,
      reasoningTokens: 0,
    });
    expect(cost).toBeCloseTo((312 * 0.05 + 1280 * 0.005 + 126 * 0.4) / 1e6, 12);
  });

  it("prices dated snapshots as their base model", () => {
    expect(costUsd("gpt-5-nano-2025-08-07", usage)).toBe(costUsd("gpt-5-nano", usage));
  });

  it("returns null for a model it cannot price", () => {
    expect(costUsd("unknown-model", usage)).toBeNull();
  });
});
