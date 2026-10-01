import type { DocumentDto, DocumentStatus } from "@closer/shared";
import { getFormatter, getTranslations } from "next-intl/server";
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_VARIANT = {
  pending: "outline",
  processing: "secondary",
  ready: "default",
  failed: "destructive",
} as const satisfies Record<DocumentStatus, ComponentProps<typeof Badge>["variant"]>;

export async function DocumentsTable({ documents }: { documents: DocumentDto[] }) {
  const [t, format] = await Promise.all([getTranslations("knowledge"), getFormatter()]);
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.document")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
            <TableHead className="text-right">{t("columns.chunks")}</TableHead>
            <TableHead className="hidden text-right md:table-cell">{t("columns.size")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("columns.added")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell className="max-w-80">
                <span className="block truncate font-medium">{doc.title}</span>
                {doc.status === "failed" && doc.error && (
                  <span className="block text-xs whitespace-normal text-destructive">
                    {doc.error}
                  </span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[doc.status]}>{t(`statuses.${doc.status}`)}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {doc.status === "ready" ? format.number(doc.chunkCount) : "—"}
              </TableCell>
              <TableCell className="hidden text-right tabular-nums md:table-cell">
                {format.number(doc.sizeBytes / 1024, { maximumFractionDigits: 0 })} KB
              </TableCell>
              <TableCell className="hidden text-muted-foreground md:table-cell">
                {format.dateTime(new Date(doc.createdAt), { dateStyle: "medium" })}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
