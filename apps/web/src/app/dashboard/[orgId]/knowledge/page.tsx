import { BookOpen } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { AutoRefresh } from "@/components/knowledge/auto-refresh";
import { DocumentsTable } from "@/components/knowledge/documents-table";
import { UploadButton } from "@/components/knowledge/upload-button";
import { getDocuments, getOrganizations } from "@/lib/api-server";
import { isProcessing } from "@/lib/documents";

export default async function KnowledgePage({ params }: PageProps<"/dashboard/[orgId]/knowledge">) {
  const { orgId } = await params;
  const [documents, organizations, t, tNav] = await Promise.all([
    getDocuments(orgId),
    getOrganizations(),
    getTranslations("knowledge"),
    getTranslations("nav.knowledge"),
  ]);
  // UI only: the API enforces the same rule (owners and agents upload).
  const role = organizations.find((org) => org.id === orgId)?.role;
  const canWrite = role === "owner" || role === "agent";
  const canDelete = role === "owner";
  const processing = isProcessing(documents);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tNav("label")}</h1>
          <p className="text-sm text-muted-foreground">{tNav("description")}</p>
        </div>
        {canWrite && <UploadButton orgId={orgId} />}
      </header>

      <AutoRefresh active={processing} />
      {processing && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("refreshing")}
        </p>
      )}

      {documents.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <BookOpen className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyDescription")}</p>
        </div>
      ) : (
        <DocumentsTable
          documents={documents}
          orgId={orgId}
          canWrite={canWrite}
          canDelete={canDelete}
        />
      )}
    </div>
  );
}
