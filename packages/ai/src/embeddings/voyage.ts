import { z } from "zod";
import type { EmbeddingInputType, EmbeddingProvider, EmbeddingResult } from "./types";
import { EMBEDDING_DIMENSIONS } from "./types";

const ENDPOINT = "https://api.voyageai.com/v1/embeddings";
/** Well under the API limits (1,000 inputs / 320k tokens per request) for typical chunks. */
const BATCH_SIZE = 128;
const MAX_ATTEMPTS = 4;

const responseSchema = z.object({
  data: z.array(z.object({ index: z.number().int(), embedding: z.array(z.number()) })),
  usage: z.object({ total_tokens: z.number().int() }),
});

export class EmbeddingError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

type Options = {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  /** Injected so tests don't actually wait between retries. */
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const isRetryable = (status: number) => status === 429 || status >= 500;

/** Voyage AI embeddings (Anthropic's recommended embedding provider), via plain HTTP. */
export function createVoyageEmbedder(options: Options): EmbeddingProvider {
  const model = options.model ?? "voyage-4";
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;

  async function embedBatch(
    input: string[],
    inputType: EmbeddingInputType,
  ): Promise<EmbeddingResult> {
    for (let attempt = 1; ; attempt++) {
      const res = await doFetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input,
          model,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
      });

      if (res.ok) {
        const parsed = responseSchema.parse(await res.json());
        const ordered = [...parsed.data].sort((a, b) => a.index - b.index);
        if (ordered.length !== input.length) {
          throw new EmbeddingError(`Expected ${input.length} embeddings, got ${ordered.length}`);
        }
        const embeddings = ordered.map((d) => {
          if (d.embedding.length !== EMBEDDING_DIMENSIONS) {
            throw new EmbeddingError(
              `Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${d.embedding.length}`,
            );
          }
          return d.embedding;
        });
        return { embeddings, tokens: parsed.usage.total_tokens };
      }

      if (!isRetryable(res.status) || attempt >= MAX_ATTEMPTS) {
        // The body may echo the request; keep only the status in the error.
        throw new EmbeddingError(`Voyage request failed with status ${res.status}`, res.status);
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 500;
      await sleep(backoff);
    }
  }

  return {
    model,
    async embed(texts, inputType) {
      const embeddings: number[][] = [];
      let tokens = 0;
      for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = await embedBatch(texts.slice(i, i + BATCH_SIZE), inputType);
        embeddings.push(...batch.embeddings);
        tokens += batch.tokens;
      }
      return { embeddings, tokens };
    },
  };
}
