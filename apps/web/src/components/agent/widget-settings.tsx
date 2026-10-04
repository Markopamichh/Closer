"use client";

import type { AgentDto } from "@closer/shared";
import { agentResponseSchema, MAX_WIDGET_ORIGINS, widgetOriginSchema } from "@closer/shared";
import { Check, Copy, ExternalLink, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiSend } from "@/lib/api-client";

/** The snippet points at this deployment; read on the client (no request URL in a client component). */
const useOrigin = () =>
  useSyncExternalStore(
    () => () => undefined,
    () => window.location.origin,
    () => "",
  );

export function WidgetSettings({
  orgId,
  agent,
  canEdit,
}: {
  orgId: string;
  agent: AgentDto;
  canEdit: boolean;
}) {
  const t = useTranslations("agentPage.widget");
  const router = useRouter();
  const origin = useOrigin();
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const path = `/api/organizations/${encodeURIComponent(orgId)}/agents/${agent.id}`;
  const snippet = `<script src="${origin}/widget.js" data-key="${agent.publicKey}" async></script>`;

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const raw = form.get("origins");
    const lines = (typeof raw === "string" ? raw : "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // Same rules as the API, checked per line so the owner sees which one is wrong.
    const bad = lines.find((line) => !widgetOriginSchema.safeParse(line).success);
    if (bad) {
      setError(t("invalidOrigin", { origin: bad }));
      return;
    }
    if (lines.length > MAX_WIDGET_ORIGINS) {
      setError(t("tooManyOrigins", { max: MAX_WIDGET_ORIGINS }));
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await apiSend(
        "PATCH",
        path,
        { widgetEnabled: form.get("enabled") === "on", allowedOrigins: lines },
        agentResponseSchema,
      );
      setStatus("saved");
      router.refresh();
    } catch {
      setError(t("saveFailed"));
      setStatus("idle");
    }
  }

  async function rotate() {
    if (!window.confirm(t("rotateConfirm"))) return;
    try {
      await apiSend("POST", `${path}/widget/rotate-key`, {}, agentResponseSchema);
      router.refresh();
    } catch {
      setError(t("saveFailed"));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <form
          onSubmit={(e) => void onSubmit(e)}
          onChange={() => {
            setStatus("idle");
          }}
          className="grid gap-4"
        >
          <fieldset disabled={!canEdit} className="grid gap-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={agent.widgetEnabled}
                className="size-4 accent-primary"
              />
              {t("enabled")}
            </label>
            <div className="grid gap-1.5">
              <Label htmlFor="widget-origins">{t("origins")}</Label>
              <Textarea
                id="widget-origins"
                name="origins"
                defaultValue={agent.allowedOrigins.join("\n")}
                placeholder="https://www.your-site.com"
                rows={3}
                aria-describedby="widget-origins-help"
              />
              <p id="widget-origins-help" className="text-xs text-muted-foreground">
                {t("originsHelp")}
              </p>
            </div>
          </fieldset>
          <FormError message={error} />
          {canEdit && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={status === "saving"}>
                {status === "saving" ? t("saving") : t("save")}
              </Button>
              {status === "saved" && (
                <span role="status" className="text-sm text-muted-foreground">
                  {t("saved")}
                </span>
              )}
            </div>
          )}
        </form>

        <div className="grid gap-2">
          <Label htmlFor="widget-snippet">{t("snippet")}</Label>
          <p className="text-xs text-muted-foreground">{t("snippetHelp")}</p>
          <pre
            id="widget-snippet"
            className="overflow-x-auto rounded-lg border bg-muted/40 p-3 font-mono text-xs whitespace-pre-wrap break-all"
          >
            {snippet}
          </pre>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(snippet).then(() => {
                  setCopied(true);
                  setTimeout(() => {
                    setCopied(false);
                  }, 2000);
                });
              }}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied ? t("copied") : t("copy")}
            </Button>
            {agent.widgetEnabled && (
              <Button asChild variant="outline" size="sm">
                <a href={`/embed/${agent.publicKey}`} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden />
                  {t("preview")}
                </a>
              </Button>
            )}
            {canEdit && (
              <Button type="button" variant="ghost" size="sm" onClick={() => void rotate()}>
                <RefreshCw className="size-4" aria-hidden />
                {t("rotate")}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
