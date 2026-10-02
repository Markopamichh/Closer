import type { ConversationSummaryDto } from "@closer/shared";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export async function ConversationList({
  conversations,
  selectedId,
  href,
}: {
  conversations: ConversationSummaryDto[];
  selectedId: string | undefined;
  href: (conversationId: string) => string;
}) {
  const [t, format] = await Promise.all([getTranslations("conversations"), getFormatter()]);
  const now = new Date();

  return (
    <ul className="grid gap-1" aria-label={t("listLabel")}>
      {conversations.map((conversation) => {
        const selected = conversation.id === selectedId;
        const at = new Date(conversation.lastMessageAt ?? conversation.createdAt);
        return (
          <li key={conversation.id}>
            <Link
              href={href(conversation.id)}
              aria-current={selected ? "page" : undefined}
              scroll={false}
              className={cn(
                "grid gap-1 rounded-lg border border-transparent px-3 py-2.5 text-sm transition-colors hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                selected && "border-border bg-muted",
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{conversation.agent.name}</span>
                <time
                  dateTime={at.toISOString()}
                  title={format.dateTime(at, { dateStyle: "medium", timeStyle: "short" })}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {format.relativeTime(at, now)}
                </time>
              </span>
              <span className="line-clamp-2 text-muted-foreground">
                {conversation.lastMessagePreview ?? t("noMessages")}
              </span>
              <span className="flex items-center gap-2">
                <Badge variant="secondary">{t(`channels.${conversation.channel}`)}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("messageCount", { count: conversation.messageCount })}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
