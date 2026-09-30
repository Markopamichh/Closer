/** Must match the `vector(1024)` column in packages/db (chunks.embedding). */
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * Retrieval models embed questions and passages differently; mixing them up silently
 * degrades search quality, so callers always say which one they are embedding.
 */
export type EmbeddingInputType = "document" | "query";

export type EmbeddingResult = {
  embeddings: number[][];
  /** Tokens billed by the provider, recorded as usage for metering. */
  tokens: number;
};

export interface EmbeddingProvider {
  /** Stored with each chunk so a later model change can be detected and re-indexed. */
  readonly model: string;
  embed(texts: string[], inputType: EmbeddingInputType): Promise<EmbeddingResult>;
}
