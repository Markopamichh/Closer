export type Chunk = { index: number; content: string; tokenCount: number };

export type ChunkOptions = {
  /** Upper bound per chunk. ~500 tokens keeps passages focused for retrieval. */
  maxTokens?: number;
  /** Context repeated from the previous chunk so answers spanning a boundary survive. */
  overlapTokens?: number;
};

/** ~4 characters per token for English/Spanish prose; exact counts come from the provider. */
const CHARS_PER_TOKEN = 4;
export const estimateTokens = (text: string) => Math.ceil(text.length / CHARS_PER_TOKEN);

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Hard split on word boundaries, for a single sentence longer than a chunk. */
function splitByWords(text: string, maxChars: number): string[] {
  const parts: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    if (current && current.length + 1 + word.length > maxChars) {
      parts.push(current);
      current = "";
    }
    // A single "word" longer than a chunk (e.g. a URL or base64 blob) is cut as-is.
    for (let i = 0; i < word.length; i += maxChars) {
      const piece = word.slice(i, i + maxChars);
      current = current ? `${current} ${piece}` : piece;
      if (current.length >= maxChars) {
        parts.push(current);
        current = "";
      }
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Paragraphs first, then sentences, then words: keep the author's structure when possible. */
function units(text: string, maxChars: number): string[] {
  return text.split(/\n\s*\n/).flatMap((paragraph) => {
    const p = paragraph.trim();
    if (!p) return [];
    if (p.length <= maxChars) return [p];
    return p
      .split(/(?<=[.!?])\s+/)
      .flatMap((sentence) =>
        sentence.length <= maxChars ? [sentence] : splitByWords(sentence, maxChars),
      );
  });
}

/** The last `chars` characters of a chunk, starting at a word boundary. */
function tail(text: string, chars: number): string {
  if (chars <= 0 || text.length <= chars) return chars <= 0 ? "" : text;
  const slice = text.slice(-chars);
  const space = slice.indexOf(" ");
  return space === -1 ? slice : slice.slice(space + 1);
}

/** Splits extracted document text into overlapping, retrieval-sized chunks. */
export function chunkText(text: string, options: ChunkOptions = {}): Chunk[] {
  const maxTokens = options.maxTokens ?? 500;
  const overlapTokens = Math.min(options.overlapTokens ?? 75, Math.floor(maxTokens / 2));
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const overlapChars = overlapTokens * CHARS_PER_TOKEN;

  const contents: string[] = [];
  let current = "";

  for (const unit of units(normalize(text), maxChars - overlapChars)) {
    const candidate = current ? `${current}\n\n${unit}` : unit;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    contents.push(current);
    const carried = tail(current, overlapChars);
    current = carried ? `${carried}\n\n${unit}` : unit;
  }
  if (current) contents.push(current);

  return contents.map((content, index) => ({
    index,
    content,
    tokenCount: estimateTokens(content),
  }));
}
