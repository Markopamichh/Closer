import { describe, expect, it } from "vitest";
import { chunkText, estimateTokens } from "../src/ingestion/chunk";

const paragraph = (n: number, words = 60) =>
  Array.from({ length: words }, (_, i) => `p${n}w${i}`).join(" ") + ".";

describe("chunkText", () => {
  it("returns nothing for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText(" \n\n \t ")).toEqual([]);
  });

  it("keeps a short document as a single chunk", () => {
    const [only, ...rest] = chunkText("Financing is available for 12 to 60 months.");
    expect(rest).toEqual([]);
    expect(only).toMatchObject({
      index: 0,
      content: "Financing is available for 12 to 60 months.",
    });
  });

  it("never exceeds the size limit, even with a giant unbroken paragraph", () => {
    const giant = Array.from({ length: 5000 }, (_, i) => `word${i}`).join(" ");
    const chunks = chunkText(`${giant}\n\nshort tail`, { maxTokens: 200, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(200 * 4);
  });

  it("splits on paragraph boundaries before cutting inside a paragraph", () => {
    const text = [paragraph(1), paragraph(2), paragraph(3)].join("\n\n");
    const chunks = chunkText(text, { maxTokens: 150, overlapTokens: 0 });
    // Each ~420-char paragraph fits in a 600-char chunk but two don't: one per chunk.
    expect(chunks.map((c) => c.content)).toEqual([paragraph(1), paragraph(2), paragraph(3)]);
  });

  it("repeats the end of the previous chunk at the start of the next (overlap)", () => {
    const text = [paragraph(1), paragraph(2)].join("\n\n");
    const [first, second] = chunkText(text, { maxTokens: 150, overlapTokens: 20 });
    const lastWord = first?.content.split(" ").at(-1) ?? "";
    expect(second?.content).toContain(lastWord);
    expect(second?.content.endsWith(paragraph(2))).toBe(true);
  });

  it("covers every word of the source text", () => {
    const text = Array.from({ length: 12 }, (_, i) => paragraph(i, 90)).join("\n\n");
    const chunks = chunkText(text, { maxTokens: 250, overlapTokens: 40 });
    const joined = chunks.map((c) => c.content).join(" ");
    for (const word of text.split(/\s+/)) expect(joined).toContain(word);
  });

  it("normalizes Windows line endings and excess blank lines", () => {
    const [chunk] = chunkText("Line one.\r\n\r\n\r\n\r\nLine two.  \r\n");
    expect(chunk?.content).toBe("Line one.\n\nLine two.");
  });

  it("numbers chunks sequentially and estimates tokens", () => {
    const chunks = chunkText(Array.from({ length: 6 }, (_, i) => paragraph(i)).join("\n\n"), {
      maxTokens: 150,
    });
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) expect(c.tokenCount).toBe(estimateTokens(c.content));
  });
});
