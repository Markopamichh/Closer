"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav";

export function Sidebar({ orgId }: { orgId: string }) {
  const active = useSelectedLayoutSegment();

  return (
    <nav aria-label="Main" className="grid gap-1 px-3">
      {NAV_ITEMS.map(({ segment, label, icon: Icon }) => {
        const isActive = active === segment;
        return (
          <Link
            key={segment}
            href={`/dashboard/${orgId}/${segment}`}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              isActive
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
