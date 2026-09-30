import { getTranslations } from "next-intl/server";
import type { NavSegment } from "./nav";
import { navItem } from "./nav";

/** Empty state for sections that land in later weeks of the roadmap. */
export async function SectionPlaceholder({ segment, week }: { segment: NavSegment; week: number }) {
  const t = await getTranslations();
  const { icon: Icon } = navItem(segment);
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t(`nav.${segment}.label`)}</h1>
        <p className="text-sm text-muted-foreground">{t(`nav.${segment}.description`)}</p>
      </header>
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <p className="font-medium">{t("placeholder.title", { week })}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t("placeholder.description")}</p>
      </div>
    </div>
  );
}
