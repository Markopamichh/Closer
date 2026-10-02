"use client";

import { agentResponseSchema } from "@closer/shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiPost } from "@/lib/api-client";

export function CreateAgentForm({ orgId }: { orgId: string }) {
  const t = useTranslations("agentPage");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    if (typeof name !== "string" || name.trim() === "") return;
    setPending(true);
    setError(null);
    try {
      await apiPost(
        `/api/organizations/${encodeURIComponent(orgId)}/agents`,
        { name: name.trim() },
        agentResponseSchema,
      );
      router.refresh();
    } catch {
      setError(t("saveFailed"));
      setPending(false);
    }
  }

  return (
    <Card className="max-w-md">
      <CardHeader>
        <CardTitle>{t("createTitle")}</CardTitle>
        <CardDescription>{t("createDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="agent-name">{t("fields.name")}</Label>
            <Input id="agent-name" name="name" placeholder="Dulce" maxLength={80} required />
          </div>
          <FormError message={error} />
          <Button type="submit" disabled={pending}>
            {pending ? t("creating") : t("createSubmit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
