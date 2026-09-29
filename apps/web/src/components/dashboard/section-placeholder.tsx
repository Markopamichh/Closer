import { navItem } from "./nav";

/** Empty state for sections that land in later weeks of the roadmap. */
export function SectionPlaceholder({ segment, week }: { segment: string; week: number }) {
  const { label, icon: Icon, description } = navItem(segment);
  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{label}</h1>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      <div className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-lg border border-dashed text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted">
          <Icon className="size-5 text-muted-foreground" aria-hidden />
        </span>
        <p className="font-medium">Coming in week {week}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This section is part of the roadmap and is not built yet.
        </p>
      </div>
    </div>
  );
}
