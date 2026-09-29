"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export function AcceptInvitation({ invitationId }: { invitationId: string }) {
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
      setError(acceptError.message ?? "This invitation could not be accepted");
      setPending(false);
      return;
    }
    router.push(`/dashboard/${data.invitation.organizationId}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Join organization</CardTitle>
        <CardDescription>You have been invited to join a workspace on Closer.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <FormError message={error} />
        <Button onClick={() => void accept()} disabled={pending}>
          {pending ? "Joining…" : "Accept invitation"}
        </Button>
      </CardContent>
    </Card>
  );
}
