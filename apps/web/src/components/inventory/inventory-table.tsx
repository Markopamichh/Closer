import type { InventoryItemDto, InventoryStatus } from "@closer/shared";
import { propertyAttributesSchema, vehicleAttributesSchema } from "@closer/shared";
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
  available: "default",
  reserved: "secondary",
  sold: "outline",
  archived: "ghost",
} as const satisfies Record<InventoryStatus, ComponentProps<typeof Badge>["variant"]>;

type T = Awaited<ReturnType<typeof getTranslations<"inventory">>>;
type Format = Awaited<ReturnType<typeof getFormatter>>;

/** One-line summary of the vertical-specific attributes, parsed rather than cast. */
function details(item: InventoryItemDto, t: T, format: Format): string {
  if (item.kind === "vehicle") {
    const v = vehicleAttributesSchema.safeParse(item.attributes);
    if (!v.success) return "";
    return [
      `${v.data.make} ${v.data.model} ${v.data.year}`,
      v.data.mileageKm === undefined ? null : `${format.number(v.data.mileageKm)} km`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  if (item.kind === "property") {
    const p = propertyAttributesSchema.safeParse(item.attributes);
    if (!p.success) return "";
    return [
      t(`operation.${p.data.operation}`),
      p.data.bedrooms === undefined ? null : t("bedrooms", { count: p.data.bedrooms }),
      p.data.areaM2 === undefined ? null : `${format.number(p.data.areaM2)} m²`,
      p.data.neighborhood ?? p.data.city ?? null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return Object.entries(item.attributes)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" · ");
}

function price(item: InventoryItemDto, t: T, format: Format): string {
  if (item.priceCents === null) return t("noPrice");
  try {
    return format.number(item.priceCents / 100, { style: "currency", currency: item.currency });
  } catch {
    // An unknown ISO code makes Intl throw; still show the amount.
    return `${item.currency} ${format.number(item.priceCents / 100)}`;
  }
}

export async function InventoryTable({ items }: { items: InventoryItemDto[] }) {
  const [t, format] = await Promise.all([getTranslations("inventory"), getFormatter()]);
  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.item")}</TableHead>
            <TableHead>{t("columns.kind")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("columns.details")}</TableHead>
            <TableHead className="text-right">{t("columns.price")}</TableHead>
            <TableHead>{t("columns.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="max-w-72">
                <span className="block truncate font-medium">{item.title}</span>
                {item.externalId && (
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {item.externalId}
                  </span>
                )}
              </TableCell>
              <TableCell>{t(`kinds.${item.kind}`)}</TableCell>
              <TableCell className="hidden max-w-80 truncate text-muted-foreground md:table-cell">
                {details(item, t, format)}
              </TableCell>
              <TableCell className="text-right tabular-nums">{price(item, t, format)}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[item.status]}>{t(`statuses.${item.status}`)}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
