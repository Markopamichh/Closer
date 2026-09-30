import { describe, expect, it, vi } from "vitest";
import { createFakeEmbedder } from "../src/embeddings/fake";
import { EMBEDDING_DIMENSIONS } from "../src/embeddings/types";
import { createVoyageEmbedder, EmbeddingError } from "../src/embeddings/voyage";

const vector = (seed: number) => new Array<number>(EMBEDDING_DIMENSIONS).fill(seed);

function voyageResponse(count: number, tokens = 10, shuffle = false) {
  const data = Array.from({ length: count }, (_, index) => ({ index, embedding: vector(index) }));
  return Response.json({ data: shuffle ? data.reverse() : data, usage: { total_tokens: tokens } });
}

const noSleep = () => Promise.resolve();

type VoyageRequest = {
  input: string[];
  model: string;
  input_type: string;
  output_dimension: number;
};

function requestBody(init: RequestInit | undefined): VoyageRequest {
  if (typeof init?.body !== "string") throw new Error("expected a JSON string body");
  return JSON.parse(init.body) as VoyageRequest;
}

describe("Voyage embedder", () => {
  it("sends the model, input type and 1024 dimensions, and returns vectors in input order", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(voyageResponse(2, 7, true));
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch: fetchMock, sleep: noSleep });

    const result = await embedder.embed(["a", "b"], "query");

    const body = requestBody(fetchMock.mock.calls[0]?.[1]);
    expect(body).toMatchObject({ model: "voyage-4", input_type: "query", output_dimension: 1024 });
    expect(result.embeddings.map((e) => e[0])).toEqual([0, 1]);
    expect(result.tokens).toBe(7);
  });

  it("splits large inputs into batches and sums token usage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      const { input } = requestBody(init);
      return Promise.resolve(voyageResponse(input.length, 5));
    });
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch: fetchMock, sleep: noSleep });

    const result = await embedder.embed(
      Array.from({ length: 300 }, (_, i) => `t${i}`),
      "document",
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.embeddings).toHaveLength(300);
    expect(result.tokens).toBe(15);
  });

  it("retries rate limits and server errors, then succeeds", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response("oops", { status: 503 }))
      .mockResolvedValueOnce(voyageResponse(1));
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch: fetchMock, sleep: noSleep });

    await expect(embedder.embed(["a"], "document")).resolves.toMatchObject({ tokens: 10 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry client errors such as a bad API key", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("nope", { status: 401 }));
    const embedder = createVoyageEmbedder({ apiKey: "bad", fetch: fetchMock, sleep: noSleep });

    await expect(embedder.embed(["a"], "document")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with the wrong dimensions instead of storing it", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ data: [{ index: 0, embedding: [0.1, 0.2] }], usage: { total_tokens: 1 } }),
      );
    const embedder = createVoyageEmbedder({ apiKey: "k", fetch: fetchMock, sleep: noSleep });

    await expect(embedder.embed(["a"], "document")).rejects.toBeInstanceOf(EmbeddingError);
  });
});

describe("fake embedder", () => {
  const cosine = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

  it("is deterministic and normalized", async () => {
    const embedder = createFakeEmbedder();
    const [first] = (await embedder.embed(["Toyota Corolla 2020"], "document")).embeddings;
    const [second] = (await embedder.embed(["Toyota Corolla 2020"], "query")).embeddings;
    expect(first).toEqual(second);
    expect(cosine(first ?? [], first ?? [])).toBeCloseTo(1);
  });

  it("ranks texts that share words above unrelated ones", async () => {
    const { embeddings } = await createFakeEmbedder().embed(
      ["financing options for used cars", "used cars financing", "apartment with two bedrooms"],
      "document",
    );
    const [query, related, unrelated] = embeddings as [number[], number[], number[]];
    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });
});
