import { listConversationsQuerySchema } from "@closer/shared";
import { MessagesSquare } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { z } from "zod";
import { ConversationList } from "@/components/conversations/conversation-list";
import { ConversationThread } from "@/components/conversations/conversation-thread";
import { Button } from "@/components/ui/button";
import { getConversation, getConversations } from "@/lib/api-server";

const PAGE_SIZE = 25;
const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export default async function ConversationsPage({
  params,
  searchParams,
}: PageProps<"/dashboard/[orgId]/conversations">) {
  const [{ orgId }, raw] = await Promise.all([params, searchParams]);
  // Lenient: a hand-edited URL falls back to the first page / no selection.
  const offset = listConversationsQuerySchema.shape.offset.safeParse(one(raw.offset)).data ?? 0;
  const requested = z.uuid().safeParse(one(raw.c)).data;

  const [page, t, tNav] = await Promise.all([
    getConversations(orgId, { limit: PAGE_SIZE, offset }),
    getTranslations("conversations"),
    getTranslations("nav.conversations"),
  ]);
  // Without a selection, open the most recent conversation.
  const selectedId = requested ?? page.conversations[0]?.id;
  const selected = selectedId ? await getConversation(orgId, selectedId) : null;

  const basePath = `/dashboard/${orgId}/conversations`;
  const href = (query: { c?: string; offset?: number }) => {
    const qs = new URLSearchParams();
    if (query.c) qs.set("c", query.c);
    if (query.offset) qs.set("offset", String(query.offset));
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = page.total === 0 ? 0 : page.offset + 1;
  const to = page.offset + page.conversations.length;

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{tNav("label")}</h1>
        <p className="text-sm text-muted-foreground">{tNav("description")}</p>
      </header>

      {page.total === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-6 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted">
            <MessagesSquare className="size-5 text-muted-foreground" aria-hidden />
          </span>
          <p className="font-medium">{t("emptyTitle")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("emptyDescription")}</p>
          <Button asChild variant="outline" size="sm">
            <Link href={`/dashboard/${orgId}/agent`}>{t("emptyAction")}</Link>
          </Button>
        </div>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
          <div className="grid gap-3">
            <ConversationList
              conversations={page.conversations}
              selectedId={selectedId}
              href={(c) => href({ c, offset })}
            />
            <nav aria-label={t("pagination")} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground tabular-nums">
                {t("range", { from, to, total: page.total })}
              </span>
              <div className="flex gap-2">
                {page.offset > 0 && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={href({ offset: Math.max(0, page.offset - PAGE_SIZE) })}>
                      {t("previous")}
                    </Link>
                  </Button>
                )}
                {to < page.total && (
                  <Button asChild variant="outline" size="sm">
                    <Link href={href({ offset: page.offset + PAGE_SIZE })}>{t("next")}</Link>
                  </Button>
                )}
              </div>
            </nav>
          </div>
          {selected ? (
            <ConversationThread conversation={selected} />
          ) : (
            <p
              role="status"
              className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground"
            >
              {t("notFound")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
