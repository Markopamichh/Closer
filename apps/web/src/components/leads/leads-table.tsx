import type { LeadDto, MemberDto } from "@closer/shared";
import { MessagesSquare } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { LeadControls } from "./lead-controls";

/** Score bands, labelled in words as well as color. */
const band = (score: number) => (score >= 80 ? "hot" : score >= 50 ? "warm" : "cold");
const BAND_VARIANT = { hot: "default", warm: "secondary", cold: "outline" } as const;

export async function LeadsTable({
  orgId,
  leads,
  members,
  canWrite,
}: {
  orgId: string;
  leads: LeadDto[];
  members: MemberDto[];
  canWrite: boolean;
}) {
  const [t, format] = await Promise.all([getTranslations("leads"), getFormatter()]);
  const now = new Date();
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.lead")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("columns.interest")}</TableHead>
            <TableHead>{t("columns.score")}</TableHead>
            <TableHead>{canWrite ? t("columns.pipeline") : t("columns.status")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("columns.created")}</TableHead>
            <TableHead className="w-12">
              <span className="sr-only">{t("columns.conversation")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => {
            const created = new Date(lead.createdAt);
            const level = band(lead.score);
            return (
              <TableRow key={lead.id}>
                <TableCell className="max-w-64">
                  <span className="block truncate font-medium">{lead.name ?? t("anonymous")}</span>
                  {(lead.email ?? lead.phone) && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {[lead.email, lead.phone].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden max-w-80 text-muted-foreground md:table-cell">
                  <span className="line-clamp-2">{lead.interest ?? "—"}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={BAND_VARIANT[level]} className="tabular-nums">
                    {lead.score} · {t(`bands.${level}`)}
                  </Badge>
                </TableCell>
                <TableCell>
                  {canWrite ? (
                    <LeadControls orgId={orgId} lead={lead} members={members} />
                  ) : (
                    <span className="grid gap-0.5">
                      <Badge variant="outline">{t(`statuses.${lead.status}`)}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {lead.assignee?.name ?? t("unassigned")}
                      </span>
                    </span>
                  )}
                </TableCell>
                <TableCell className="hidden text-muted-foreground lg:table-cell">
                  <time
                    dateTime={lead.createdAt}
                    title={format.dateTime(created, { dateStyle: "medium", timeStyle: "short" })}
                  >
                    {format.relativeTime(created, now)}
                  </time>
                </TableCell>
                <TableCell>
                  {lead.conversationId && (
                    <Link
                      href={`/dashboard/${orgId}/conversations?c=${lead.conversationId}`}
                      aria-label={t("openConversation", { name: lead.name ?? t("anonymous") })}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <MessagesSquare className="size-4" aria-hidden />
                    </Link>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
