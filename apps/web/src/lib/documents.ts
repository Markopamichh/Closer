import type { DocumentDto } from "@closer/shared";
import { DOCUMENT_UPLOAD_LIMITS } from "@closer/shared";

export type UploadProblem = "type" | "size" | "empty";

/** Fast client-side check before uploading; the API still validates type by content. */
export function checkUpload(file: Pick<File, "name" | "size">): UploadProblem | null {
  const name = file.name.toLowerCase();
  if (!DOCUMENT_UPLOAD_LIMITS.extensions.some((ext) => name.endsWith(ext))) return "type";
  if (file.size === 0) return "empty";
  if (file.size > DOCUMENT_UPLOAD_LIMITS.maxBytes) return "size";
  return null;
}

/** Keep refreshing only while some document is still moving through the worker. */
export const isProcessing = (documents: Pick<DocumentDto, "status">[]) =>
  documents.some((d) => d.status === "pending" || d.status === "processing");

/** Mirrors the API: a document already queued or processing can't be re-queued (409). */
export const canReprocess = (status: DocumentDto["status"]) =>
  status === "ready" || status === "failed";
