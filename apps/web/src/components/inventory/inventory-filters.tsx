import type { InventoryKind, InventoryStatus } from "@closer/shared";
import { INVENTORY_KINDS, INVENTORY_STATUSES } from "@closer/shared";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const selectClass =
  "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

/** A plain GET form: filters live in the URL, so they survive reloads and can be shared. */
export async function InventoryFilters({
  basePath,
  q,
  status,
  kind,
}: {
  basePath: string;
  q?: string;
  status?: InventoryStatus;
  kind?: InventoryKind;
}) {
  const t = await getTranslations("inventory");
  return (
    <form action={basePath} className="flex flex-wrap items-end gap-3">
      <div className="grid min-w-56 flex-1 gap-1.5">
        <Label htmlFor="inventory-q">{t("searchLabel")}</Label>
        <Input
          id="inventory-q"
          name="q"
          type="search"
          defaultValue={q}
          placeholder={t("searchPlaceholder")}
          maxLength={100}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="inventory-status">{t("statusLabel")}</Label>
        <select
          id="inventory-status"
          name="status"
          defaultValue={status ?? ""}
          className={selectClass}
        >
          <option value="">{t("allStatuses")}</option>
          {INVENTORY_STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`statuses.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="inventory-kind">{t("kindLabel")}</Label>
        <select id="inventory-kind" name="kind" defaultValue={kind ?? ""} className={selectClass}>
          <option value="">{t("allKinds")}</option>
          {INVENTORY_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`kinds.${value}`)}
            </option>
          ))}
        </select>
      </div>
      <Button type="submit" variant="secondary">
        {t("apply")}
      </Button>
      {(q ?? status ?? kind) && (
        <Button asChild variant="ghost">
          <Link href={basePath}>{t("clear")}</Link>
        </Button>
      )}
    </form>
  );
}
