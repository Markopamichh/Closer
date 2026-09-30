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

// Mirrors the API's rules for a fast client-side check; the API remains the authority.
// Issue messages are translation keys, resolved at render time.
const registerSchema = z.object({
  name: z.string().trim().min(1, "name").max(80, "name"),
  email: z.email("email"),
  password: z.string().min(10, "password"),
});
const FIELD_ERRORS = ["name", "email", "password"] as const;

export function RegisterForm({ next }: { next: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = registerSchema.safeParse(Object.fromEntries(new FormData(event.currentTarget)));
    if (!parsed.success) {
      const field = FIELD_ERRORS.find((f) => f === parsed.error.issues[0]?.message) ?? "name";
      setError(t(`register.errors.${field}`));
      return;
    }
    setPending(true);
    setError(null);
    const { error: signUpError } = await authClient.signUp.email(parsed.data);
    setPending(false);
    if (signUpError) {
      setError(signUpError.message ?? t("register.failed"));
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("register.title")}</CardTitle>
        <CardDescription>{t("register.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="name">{t("register.name")}</Label>
            <Input id="name" name="name" autoComplete="name" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="email">{t("register.email")}</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">{t("common.password")}</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
            />
          </div>
          <FormError message={error} />
          <Button type="submit" disabled={pending}>
            {pending ? t("register.submitting") : t("register.submit")}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            {t("register.haveAccount")}{" "}
            <Link
              href={`/login?next=${encodeURIComponent(next)}`}
              className="underline underline-offset-4"
            >
              {t("register.signIn")}
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
