"use client";

import type { AgentDto } from "@closer/shared";
import {
  AGENT_MODEL_PRICES,
  AGENT_MODELS,
  AGENT_TONES,
  agentResponseSchema,
  updateAgentSchema,
} from "@closer/shared";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { apiSend } from "@/lib/api-client";

const selectClass =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 dark:bg-input/30";

export function AgentConfigForm({
  orgId,
  agent,
  canEdit,
  timezones,
}: {
  orgId: string;
  agent: AgentDto;
  canEdit: boolean;
  /** From the server, so the options match on hydration. */
  timezones: string[];
}) {
  const t = useTranslations("agentPage");
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" ? value : "";
    };
    const parsed = updateAgentSchema.safeParse({
      name: text("name"),
      tone: text("tone"),
      model: text("model"),
      timezone: text("timezone"),
      systemPrompt: text("systemPrompt"),
      rules: text("rules")
        .split("\n")
        .map((rule) => rule.trim())
        .filter(Boolean),
    });
    if (!parsed.success) {
      setError(t("saveFailed"));
      return;
    }
    setStatus("saving");
    setError(null);
    try {
      await apiSend(
        "PATCH",
        `/api/organizations/${encodeURIComponent(orgId)}/agents/${agent.id}`,
        parsed.data,
        agentResponseSchema,
      );
      setStatus("saved");
      router.refresh();
    } catch {
      setError(t("saveFailed"));
      setStatus("idle");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("configTitle")}</CardTitle>
        <CardDescription>{canEdit ? t("configDescription") : t("readOnly")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => void onSubmit(e)}
          onChange={() => {
            setStatus("idle");
          }}
          className="grid gap-4"
        >
          <fieldset disabled={!canEdit} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cfg-name">{t("fields.name")}</Label>
                <Input
                  id="cfg-name"
                  name="name"
                  defaultValue={agent.name}
                  maxLength={80}
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cfg-tone">{t("fields.tone")}</Label>
                <select id="cfg-tone" name="tone" defaultValue={agent.tone} className={selectClass}>
                  {AGENT_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t(`tones.${tone}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cfg-model">{t("fields.model")}</Label>
              <select
                id="cfg-model"
                name="model"
                defaultValue={agent.model}
                className={selectClass}
              >
                {AGENT_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {model} —{" "}
                    {t("modelPrice", {
                      input: AGENT_MODEL_PRICES[model].input,
                      output: AGENT_MODEL_PRICES[model].output,
                    })}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cfg-timezone">{t("fields.timezone")}</Label>
              <select
                id="cfg-timezone"
                name="timezone"
                defaultValue={agent.timezone}
                className={selectClass}
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">{t("fields.timezoneHelp")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cfg-rules">{t("fields.rules")}</Label>
              <Textarea
                id="cfg-rules"
                name="rules"
                defaultValue={agent.rules.join("\n")}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">{t("fields.rulesHelp")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cfg-notes">{t("fields.notes")}</Label>
              <Textarea
                id="cfg-notes"
                name="systemPrompt"
                defaultValue={agent.systemPrompt}
                rows={4}
                maxLength={20_000}
              />
              <p className="text-xs text-muted-foreground">{t("fields.notesHelp")}</p>
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
      </CardContent>
    </Card>
  );
}
