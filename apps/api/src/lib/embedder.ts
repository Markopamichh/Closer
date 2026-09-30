import type { EmbeddingProvider } from "@closer/ai";
import { createFakeEmbedder, createVoyageEmbedder } from "@closer/ai";
import type { Env } from "../env";
import type { Logger } from "./logger";

/** Voyage when a key is configured; the offline fake otherwise (env forbids that in production). */
export function createEmbedder(env: Env, logger: Logger): EmbeddingProvider {
  if (env.VOYAGE_API_KEY) {
    return createVoyageEmbedder({ apiKey: env.VOYAGE_API_KEY, model: env.EMBEDDING_MODEL });
  }
  logger.warn("VOYAGE_API_KEY not set: using the offline fake embedder (search is not semantic)");
  return createFakeEmbedder();
}
