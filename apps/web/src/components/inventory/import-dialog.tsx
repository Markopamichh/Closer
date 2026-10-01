"use client";

import type { CsvImportResult } from "@closer/shared";
import { CSV_IMPORT_LIMITS, csvImportResultSchema } from "@closer/shared";
import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiUpload } from "@/lib/api-client";

const TEMPLATE = [
  "external_id,kind,title,description,price,currency,status,make,model,year,mileage_km,operation,property_type,bedrooms,area_m2,neighborhood",
  "VIN-0001,vehicle,Toyota Corolla XEi 2021,One owner,18500,USD,available,Toyota,Corolla,2021,45000,,,,,",
  "APT-0001,property,2BR apartment in Palermo,Balcony and garage,950,USD,available,,,,,rent,apartment,2,65,Palermo",
].join("\n");
const TEMPLATE_HREF = `data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`;
const MAX_MB = CSV_IMPORT_LIMITS.maxBytes / 1024 / 1024;

export function ImportDialog({ orgId }: { orgId: string }) {
  const t = useTranslations("inventory.import");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"validate" | "import" | null>(null);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setFile(null);
      setPreview(null);
      setError(null);
    }
  }

  async function send(dryRun: boolean): Promise<CsvImportResult | null> {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file);
    try {
      return await apiUpload(
        `/api/organizations/${encodeURIComponent(orgId)}/inventory/import?dryRun=${dryRun}`,
        form,
        csvImportResultSchema,
        [422],
      );
    } catch (err) {
      // Format problems (missing columns, unreadable file) come back as a plain error.
      setError(err instanceof Error ? err.message : t("failed"));
      return null;
    }
  }

  async function validate() {
    setPending("validate");
    setError(null);
    setPreview(await send(true));
    setPending(null);
  }

  async function runImport() {
    setPending("import");
    setError(null);
    const result = await send(false);
    setPending(null);
    if (result?.applied) {
      setOpen(false);
      router.refresh();
    } else {
      // Something changed since the preview; show the fresh report.
      setPreview(result);
    }
  }

  const valid = preview !== null && preview.errors.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Upload className="size-4" aria-hidden />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <a
          href={TEMPLATE_HREF}
          download="inventory-template.csv"
          className="w-fit text-sm underline underline-offset-4"
        >
          {t("template")}
        </a>

        <div className="grid gap-1.5">
          <Label htmlFor="import-file">{t("file")}</Label>
          <Input
            id="import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const next = e.target.files?.[0] ?? null;
              setPreview(null);
              setError(
                next && next.size > CSV_IMPORT_LIMITS.maxBytes
                  ? t("tooLarge", { mb: MAX_MB })
                  : null,
              );
              setFile(next && next.size <= CSV_IMPORT_LIMITS.maxBytes ? next : null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            {t("fileHelp", { rows: CSV_IMPORT_LIMITS.maxRows, mb: MAX_MB })}
          </p>
        </div>

        {preview && valid && (
          <p role="status" className="rounded-md bg-muted px-3 py-2 text-sm">
            {t("summary", {
              total: preview.totalRows,
              created: preview.created,
              updated: preview.updated,
            })}
          </p>
        )}
        {preview && !valid && (
          <div
            role="alert"
            className="grid gap-2 rounded-md border border-destructive/40 p-3 text-sm"
          >
            <p className="font-medium text-destructive">
              {t("errorsTitle", { count: preview.errors.length })}
            </p>
            <ul className="grid max-h-48 gap-1 overflow-y-auto">
              {preview.errors.map((e) => (
                <li key={`${e.row}-${e.message}`}>
                  <span className="font-medium">{t("row", { row: e.row })}</span>: {e.message}
                </li>
              ))}
            </ul>
            {preview.errorsTruncated && (
              <p className="text-muted-foreground">
                {t("errorsTruncated", { count: preview.errors.length })}
              </p>
            )}
          </div>
        )}
        <FormError message={error} />

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {t("cancel")}
            </Button>
          </DialogClose>
          {valid ? (
            <Button onClick={() => void runImport()} disabled={pending !== null}>
              {pending === "import" ? t("importing") : t("import", { total: preview.totalRows })}
            </Button>
          ) : (
            <Button onClick={() => void validate()} disabled={!file || pending !== null}>
              {pending === "validate" ? t("validating") : t("validate")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
