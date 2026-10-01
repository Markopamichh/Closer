import { listInventoryQuerySchema } from "@closer/shared";
import { Package } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { InventoryFilters } from "@/components/inventory/inventory-filters";
import { ImportDialog } from "@/components/inventory/import-dialog";
import { InventoryTable } from "@/components/inventory/inventory-table";
import { ItemDialog } from "@/components/inventory/item-dialog";
import { Button } from "@/components/ui/button";
import { getInventory, getOrganizations } from "@/lib/api-server";

const PAGE_SIZE = 25;
const { shape } = listInventoryQuerySchema;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function InventoryPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[orgId]/inventory">) {
  const [{ orgId }, raw] = await Promise.all([params, searchParams]);
  // Lenient: an invalid filter in a hand-edited URL is dropped instead of failing the page.
  const filters = {
    q: shape.q.safeParse(one(raw.q) || undefined).data,
    status: shape.status.safeParse(one(raw.status) || undefined).data,
    kind: shape.kind.safeParse(one(raw.kind) || undefined).data,
    offset: shape.offset.safeParse(one(raw.offset)).data ?? 0,
  };
  const [page, organizations, t, tNav] = await Promise.all([
    getInventory(orgId, { ...filters, limit: PAGE_SIZE }),
    getOrganizations(),
    getTranslations("inventory"),
    getTranslations("nav.inventory"),
  ]);
  // UI only: the API enforces the same rule (owners and agents write).
  const role = organizations.find((org) => org.id === orgId)?.role;
  const canWrite = role === "owner" || role === "agent";
  const basePath = `/dashboard/${orgId}/inventory`;
  const filtered = Boolean(filters.q ?? filters.status ?? filters.kind);

  const pageHref = (offset: number) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries({ ...filters, offset })) {
      if (value !== undefined && value !== 0) query.set(key, String(value));
    }
    const qs = query.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = page.offset + page.items.length;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{tNav("label")}</h1>
          <p className="text-sm text-muted-foreground">{tNav("description")}</p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <ImportDialog orgId={orgId} />
            <ItemDialog orgId={orgId} />
          </div>
        )}
      </header>

      <InventoryFilters basePath={basePath} {...filters} />

      {page.items.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <Package className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-medium">{filtered ? t("noResultsTitle") : t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {filtered ? t("noResultsDescription") : t("emptyDescription")}
          </p>
        </div>
      ) : (
        <>
          <InventoryTable items={page.items} orgId={orgId} canWrite={canWrite} />
          <nav aria-label={t("pagination")} className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground tabular-nums">
              {t("range", { from, to, total: page.total })}
            </span>
            <div className="flex gap-2">
              {page.offset > 0 && (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(Math.max(0, page.offset - PAGE_SIZE))}>{t("previous")}</Link>
                </Button>
              )}
              {to < page.total && (
                <Button asChild variant="outline" size="sm">
                  <Link href={pageHref(page.offset + PAGE_SIZE)}>{t("next")}</Link>
                </Button>
              )}
            </div>
          </nav>
        </>
      )}
    </div>
  );
}
