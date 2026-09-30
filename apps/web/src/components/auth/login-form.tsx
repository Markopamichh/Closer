"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { FormError } from "./form-error";

const loginSchema = z.object({ email: z.string(), password: z.string() });

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const credentials = loginSchema.parse(Object.fromEntries(new FormData(event.currentTarget)));
    setPending(true);
    setError(null);
    const { error: signInError } = await authClient.signIn.email(credentials);
    setPending(false);
    if (signInError) {
      setError(
        signInError.code === "INVALID_EMAIL_OR_PASSWORD"
          ? t("login.failed")
          : (signInError.message ?? t("login.failed")),
      );
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("login.title")}</CardTitle>
        <CardDescription>{t("login.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="email">{t("common.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("common.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <FormError message={error} />
          <Button type="submit" disabled={pending}>
            {pending ? t("login.submitting") : t("login.submit")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("login.noAccount")}{" "}
            <Link
              href={`/register?next=${encodeURIComponent(next)}`}
              className="underline underline-offset-4"
            >
              {t("login.createOne")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
