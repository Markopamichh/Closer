"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
  const t = useTranslations("invitation");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function accept() {
    setPending(true);
    setError(null);
    const { data, error: acceptError } = await authClient.organization.acceptInvitation({
      invitationId,
    });
    if (acceptError) {
      setError(acceptError.message ?? t("failed"));
      setPending(false);
      return;
    }
    router.push(`/dashboard/${data.invitation.organizationId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={error} />
        <Button onClick={() => void accept()} disabled={pending}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </CardContent>
    </Card>
  );
}
