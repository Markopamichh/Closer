import type { EmbeddingProvider } from "./types";
import { EMBEDDING_DIMENSIONS } from "./types";

function hashToken(token: string): number {
  // FNV-1a, stable across runs and platforms.
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % EMBEDDING_DIMENSIONS;
}

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Deterministic, offline embeddings for tests and local development without an API key.
 * A normalized bag-of-words: texts sharing words are closer, so retrieval tests are
 * meaningful without calling a real model.
 */
export function createFakeEmbedder(): EmbeddingProvider {
  return {
    model: "fake-bow-1024",
    embed(texts) {
      let tokens = 0;
      const embeddings = texts.map((text) => {
        const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
        const words = tokenize(text);
        tokens += words.length;
        for (const word of words) {
          const slot = hashToken(word);
          vector[slot] = (vector[slot] ?? 0) + 1;
        }
        const norm = Math.hypot(...vector) || 1;
        return vector.map((v) => v / norm);
      });
      return Promise.resolve({ embeddings, tokens });
    },
  };
}
