import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CreateOrgForm } from "@/components/orgs/create-org-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getOrganizations } from "@/lib/api-server";

export default async function SelectOrgPage() {
  const [organizations, t] = await Promise.all([getOrganizations(), getTranslations()]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <div className="grid w-full max-w-md gap-6">
        {organizations.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>{t("orgs.chooseTitle")}</CardTitle>
              <CardDescription>{t("orgs.chooseDescription")}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {organizations.map((org) => (
                <Link
                  key={org.id}
                  href={`/dashboard/${org.id}`}
                  className="flex items-center justify-between rounded-md border px-4 py-3 transition-colors hover:bg-muted"
                >
                  <span>
                    <span className="block font-medium">{org.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {t(`common.roles.${org.role}`)}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader>
            <CardTitle>
              {organizations.length > 0 ? t("orgs.newTitle") : t("orgs.firstTitle")}
            </CardTitle>
            <CardDescription>{t("orgs.createDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <CreateOrgForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
