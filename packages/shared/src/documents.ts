import { z } from "zod";

export const DOCUMENT_STATUSES = ["pending", "processing", "ready", "failed"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const DOCUMENT_UPLOAD_LIMITS = {
  maxBytes: 20 * 1024 * 1024,
  extensions: [".pdf", ".docx", ".txt", ".md"],
};

/** Document as exposed by the API (internal fields like the storage path are omitted). */
export const documentSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(DOCUMENT_STATUSES),
  error: z.string().nullable(),
  mimeType: z.string().nullable(),
  sizeBytes: z.number().int(),
  chunkCount: z.number().int(),
  createdAt: z.string(),
  processedAt: z.string().nullable(),
});
export type DocumentDto = z.infer<typeof documentSchema>;

export const documentListSchema = z.object({ documents: z.array(documentSchema) });
