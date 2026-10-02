import { AGENT_MODEL_PRICES } from "@closer/shared";
import type { LlmUsage } from "./types";

const PRICES: Record<string, { input: number; cachedInput: number; output: number } | undefined> =
  AGENT_MODEL_PRICES;

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
