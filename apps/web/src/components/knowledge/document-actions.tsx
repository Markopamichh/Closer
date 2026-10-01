"use client";

import type { DocumentDto } from "@closer/shared";
import { documentSchema } from "@closer/shared";
import { MoreHorizontal, RotateCw, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
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
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError, apiDelete, apiSend } from "@/lib/api-client";
import { canReprocess } from "@/lib/documents";

const documentResponseSchema = z.object({ document: documentSchema });

export function DocumentActions({
  orgId,
  document,
  canDelete,
}: {
  orgId: string;
  document: Pick<DocumentDto, "id" | "title" | "status">;
  canDelete: boolean;
}) {
  const t = useTranslations("knowledge");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/organizations/${encodeURIComponent(orgId)}/documents/${document.id}`;

  async function reprocess() {
    try {
      await apiSend("POST", `${path}/reprocess`, {}, documentResponseSchema);
    } catch (err) {
      // 409: someone else re-queued it meanwhile; the refresh below shows the real state.
      if (!(err instanceof ApiError && err.status === 409)) setError(t("actionFailed"));
    }
    router.refresh();
  }

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await apiDelete(path);
      setConfirming(false);
      router.refresh();
    } catch {
      setError(t("actionFailed"));
    } finally {
      setPending(false);
    }
  }

  const showReprocess = canReprocess(document.status);
  if (!showReprocess && !canDelete) return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("actions", { title: document.title })}>
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {showReprocess && (
            <DropdownMenuItem onSelect={() => void reprocess()}>
              <RotateCw className="size-4" aria-hidden />
              {t("reprocess")}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                setError(null);
                setConfirming(true);
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              {t("delete")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && !confirming && <FormError message={error} />}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", { title: document.title })}
            </DialogDescription>
          </DialogHeader>
          <FormError message={error} />
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("cancel")}</Button>
            </DialogClose>
            <Button variant="destructive" disabled={pending} onClick={() => void remove()}>
              {pending ? t("deleting") : t("deleteYes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
