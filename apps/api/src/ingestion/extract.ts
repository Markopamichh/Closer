import mammoth from "mammoth";
import { extractText as extractPdfText, getDocumentProxy } from "unpdf";

export const DOCUMENT_FORMATS = {
  pdf: { mimeType: "application/pdf" },
  docx: { mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
  text: { mimeType: "text/plain" },
} as const;
export type DocumentFormat = keyof typeof DOCUMENT_FORMATS;

/** A problem with the file itself: retrying will not help, so the job fails permanently. */
export class ExtractionError extends Error {}

const startsWith = (bytes: Uint8Array, signature: number[]) =>
  signature.every((byte, i) => bytes[i] === byte);

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\3\4 (DOCX is a zip)

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * Decides the format from the file's content, using the extension only to pick
 * between candidates. A renamed executable is rejected instead of trusted.
 */
export function detectFormat(filename: string, bytes: Uint8Array): DocumentFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return startsWith(bytes, PDF_MAGIC) ? "pdf" : null;
  if (ext === "docx") return startsWith(bytes, ZIP_MAGIC) ? "docx" : null;
  if (["txt", "md", "markdown"].includes(ext)) return isUtf8Text(bytes) ? "text" : null;
  return null;
}

export async function extractText(format: DocumentFormat, bytes: Uint8Array): Promise<string> {
  try {
    switch (format) {
      case "pdf": {
        // unpdf may transfer the buffer to its worker; give it a copy.
        const pdf = await getDocumentProxy(new Uint8Array(bytes));
        const { text } = await extractPdfText(pdf, { mergePages: true });
        return text;
      }
      case "docx": {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
        return value;
      }
      case "text":
        return new TextDecoder("utf-8").decode(bytes);
    }
  } catch (err) {
    throw new ExtractionError(
      `Could not read the ${format.toUpperCase()} file${err instanceof Error ? `: ${err.message}` : ""}`,
    );
  }
}
