"use client";

import type { ChunkSearchHitDto } from "@closer/shared";
import { chunkSearchResponseSchema } from "@closer/shared";
import { Search } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/auth/form-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiGet } from "@/lib/api-client";
import { isOfflineEmbedder } from "@/lib/documents";

/**
 * Client-side on purpose: every search embeds the query (metered usage), so it must run
 * on submit only, never again when the page re-renders while documents are processing.
 */
export function KnowledgeSearch({ orgId }: { orgId: string }) {
  const t = useTranslations("knowledge.search");
  const format = useFormatter();
  const [results, setResults] = useState<ChunkSearchHitDto[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = new FormData(event.currentTarget).get("q");
    if (typeof q !== "string" || q.trim() === "") return;
    setPending(true);
    setError(null);
    try {
      const params = new URLSearchParams({ q: q.trim(), limit: "5" });
      const body = await apiGet(
        `/api/organizations/${encodeURIComponent(orgId)}/documents/search?${params}`,
        chunkSearchResponseSchema,
      );
      setResults(body.results);
      setOffline(isOfflineEmbedder(body.model));
    } catch {
      setError(t("failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={(e) => void onSubmit(e)} className="flex items-end gap-2">
          <div className="grid flex-1 gap-1.5">
            <Label htmlFor="knowledge-q">{t("label")}</Label>
            <Input
              id="knowledge-q"
              name="q"
              placeholder={t("placeholder")}
              maxLength={500}
              required
            />
          </div>
          <Button type="submit" disabled={pending}>
            <Search className="size-4" aria-hidden />
            {pending ? t("searching") : t("submit")}
          </Button>
        </form>
        <FormError message={error} />
        {offline && (
          <p className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
            {t("offline")}
          </p>
        )}
        {results?.length === 0 && <p className="text-sm text-muted-foreground">{t("noResults")}</p>}
        {results && results.length > 0 && (
          <ol className="grid gap-3" aria-live="polite">
            {results.map((hit) => (
              <li key={hit.chunkId} className="grid gap-1 rounded-md border p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted-foreground">
                  <span>
                    <span className="font-medium text-foreground">{hit.documentTitle}</span>
                    {" · "}
                    {t("chunk", { index: hit.chunkIndex + 1 })}
                  </span>
                  <span className="tabular-nums">
                    {t("relevance", {
                      score: format.number(hit.score, { maximumFractionDigits: 2 }),
                    })}
                  </span>
                </div>
                <p className="line-clamp-4 text-sm whitespace-pre-line">{hit.content}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
