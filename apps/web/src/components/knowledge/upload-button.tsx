"use client";

import { DOCUMENT_UPLOAD_LIMITS, documentSchema } from "@closer/shared";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { z } from "zod";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { apiUpload } from "@/lib/api-client";
import { checkUpload } from "@/lib/documents";

const uploadResponseSchema = z.object({ document: documentSchema });

export function UploadButton({ orgId }: { orgId: string }) {
  const t = useTranslations("knowledge");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(file: File) {
    const problem = checkUpload(file);
    if (problem) {
      setError(t(`problems.${problem}`));
      return;
    }
    const form = new FormData();
    form.append("file", file);
    setPending(true);
    setError(null);
    try {
      await apiUpload(
        `/api/organizations/${encodeURIComponent(orgId)}/documents`,
        form,
        uploadResponseSchema,
      );
      router.refresh();
    } catch (err) {
      // The API's message explains type mismatches (e.g. a text file renamed to .pdf).
      setError(err instanceof Error ? err.message : t("uploadFailed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid justify-items-end gap-1">
      <input
        ref={input}
        type="file"
        accept={DOCUMENT_UPLOAD_LIMITS.extensions.join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void upload(file);
        }}
      />
      <Button onClick={() => input.current?.click()} disabled={pending}>
        <Upload className="size-4" aria-hidden />
        {pending ? t("uploading") : t("upload")}
      </Button>
      {error ? (
        <FormError message={error} />
      ) : (
        <p className="text-xs text-muted-foreground">{t("uploadHelp")}</p>
      )}
    </div>
  );
}
