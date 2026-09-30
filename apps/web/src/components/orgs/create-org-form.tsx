"use client";

import { createdOrganizationSchema, createOrganizationSchema } from "@closer/shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api-client";

export function CreateOrgForm() {
  const t = useTranslations("orgs");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = createOrganizationSchema.safeParse({
      name: new FormData(event.currentTarget).get("name"),
    });
    if (!parsed.success) {
      setError(t("nameInvalid"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const org = await apiPost("/api/organizations", parsed.data, createdOrganizationSchema);
      router.push(`/dashboard/${org.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("failed"));
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3" noValidate>
      <div className="grid gap-2">
        <Label htmlFor="org-name">{t("name")}</Label>
        <Input id="org-name" name="name" placeholder={t("namePlaceholder")} required />
      </div>
      <FormError message={error} />
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
