import { notFound } from "next/navigation";
import { OrgSwitcher } from "@/components/dashboard/org-switcher";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Preferences } from "@/components/preferences";
import { UserMenu } from "@/components/dashboard/user-menu";
import { Separator } from "@/components/ui/separator";
import { getMe, getOrganizations } from "@/lib/api-server";

export default async function DashboardLayout({
  children,
  params,
}: LayoutProps<"/dashboard/[orgId]">) {
  const { orgId } = await params;
  const [{ user }, organizations] = await Promise.all([getMe(), getOrganizations()]);

  // Same rule as the API: an org you don't belong to is indistinguishable from one that
  // doesn't exist. The API enforces this on every call; this only avoids a broken shell.
  const current = organizations.find((org) => org.id === orgId);
  if (!current) notFound();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 flex-col gap-4 border-r bg-muted/30 py-4 md:flex">
        <div className="px-3">
          <OrgSwitcher current={current} organizations={organizations} />
        </div>
        <Separator />
        <Sidebar orgId={orgId} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-6">
          <span className="text-sm text-muted-foreground md:hidden">{current.name}</span>
          <div className="ml-auto flex items-center gap-2">
            <Preferences />
            <UserMenu name={user.name} email={user.email} />
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
