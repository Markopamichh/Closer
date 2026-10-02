import type { LlmUsage } from "./types";

/**
 * USD per 1M tokens, standard tier, from the official OpenAI pricing page (checked
 * 2026-10-01). Update together with AGENT_MODELS; an unpriced model costs `null`.
 */
const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-5-nano": { input: 0.05, cachedInput: 0.005, output: 0.4 },
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-5.6-luna": { input: 0.2, cachedInput: 0.02, output: 1.2 },
  "gpt-5-mini": { input: 0.25, cachedInput: 0.025, output: 2.0 },
};

/** The API reports dated snapshots ("gpt-5-nano-2025-08-07"); price them as their base model. */
const baseModel = (model: string) => model.replace(/-\d{4}-\d{2}-\d{2}$/, "");

/** Cached input is a subset of input tokens; reasoning tokens are billed as output. */
export function costUsd(model: string, usage: LlmUsage): number | null {
  const price = PRICES[baseModel(model)];
  if (!price) return null;
  const uncached = usage.inputTokens - usage.cachedInputTokens;
  return (
    (uncached * price.input +
      usage.cachedInputTokens * price.cachedInput +
      usage.outputTokens * price.output) /
    1_000_000
  );
}
