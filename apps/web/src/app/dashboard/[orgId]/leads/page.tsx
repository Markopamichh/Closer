import { LEAD_STATUSES, listLeadsQuerySchema } from "@closer/shared";
import { UserRound } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LeadsTable } from "@/components/leads/leads-table";
import { Button } from "@/components/ui/button";
import { getLeads, getMembers, getOrganizations } from "@/lib/api-server";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const { shape } = listLeadsQuerySchema;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function LeadsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[orgId]/leads">) {
  const [{ orgId }, raw] = await Promise.all([params, searchParams]);
  // Lenient: an invalid filter in a hand-edited URL is dropped instead of failing the page.
  const status = shape.status.safeParse(one(raw.status) || undefined).data;
  const offset = shape.offset.safeParse(one(raw.offset)).data ?? 0;

  const [page, members, organizations, t, tNav] = await Promise.all([
    getLeads(orgId, { status, limit: PAGE_SIZE, offset }),
    getMembers(orgId),
    getOrganizations(),
    getTranslations("leads"),
    getTranslations("nav.leads"),
  ]);
  // UI only: the API enforces the same rule (owners and agents work leads).
  const role = organizations.find((org) => org.id === orgId)?.role;
  const canWrite = role === "owner" || role === "agent";

  const basePath = `/dashboard/${orgId}/leads`;
  const href = (query: { status?: string; offset?: number }) => {
    const qs = new URLSearchParams();
    if (query.status) qs.set("status", query.status);
    if (query.offset) qs.set("offset", String(query.offset));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = page.offset + page.leads.length;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{tNav("label")}</h1>
        <p className="text-sm text-muted-foreground">{tNav("description")}</p>
      </header>

      <nav aria-label={t("filterLabel")} className="flex flex-wrap gap-1">
        {[undefined, ...LEAD_STATUSES].map((value) => {
          const active = value === status;
          return (
            <Link
              key={value ?? "all"}
              href={href({ status: value })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                active
                  ? "border-foreground bg-foreground text-background hover:bg-foreground"
                  : "text-muted-foreground",
              )}
            >
              {value ? t(`statuses.${value}`) : t("all")}
            </Link>
          );
        })}
      </nav>

      {page.leads.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <UserRound className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-medium">{status ? t("noResultsTitle") : t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {status ? t("noResultsDescription") : t("emptyDescription")}
          </p>
        </div>
      ) : (
        <>
          <LeadsTable orgId={orgId} leads={page.leads} members={members} canWrite={canWrite} />
          <nav aria-label={t("pagination")} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground tabular-nums">
              {t("range", { from, to, total: page.total })}
            </span>
            <div className="flex gap-2">
              {page.offset > 0 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ status, offset: Math.max(0, page.offset - PAGE_SIZE) })}>
                    {t("previous")}
                  </Link>
                </Button>
              )}
              {to < page.total && (
                <Button asChild variant="outline" size="sm">
                  <Link href={href({ status, offset: page.offset + PAGE_SIZE })}>{t("next")}</Link>
                </Button>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
