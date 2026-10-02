import type { ConversationDetail, ToolCallDto } from "@closer/shared";
import { AlertCircle, ChevronRight, Search } from "lucide-react";
import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

type Conversation = ConversationDetail["conversation"];
type Format = Awaited<ReturnType<typeof getFormatter>>;

const usd = (format: Format, value: number) =>
  format.number(value, { style: "currency", currency: "USD", maximumSignificantDigits: 2 });

const KNOWN_TOOLS = ["search_inventory", "get_inventory_item", "search_knowledge"] as const;
const isKnownTool = (name: string): name is (typeof KNOWN_TOOLS)[number] =>
  (KNOWN_TOOLS as readonly string[]).includes(name);

async function ToolCall({ call }: { call: ToolCallDto }) {
  const t = await getTranslations("conversations");
  const failed = call.status === "error";
  return (
    <details className="group rounded-md border bg-background text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5 text-muted-foreground select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="size-3 transition-transform group-open:rotate-90 motion-reduce:transition-none"
          aria-hidden
        />
        {failed ? (
          <AlertCircle className="size-3 text-destructive" aria-hidden />
        ) : (
          <Search className="size-3" aria-hidden />
        )}
        <span className="font-medium text-foreground">
          {isKnownTool(call.name) ? t(`tools.${call.name}`) : call.name}
        </span>
        <span className="tabular-nums">· {t("latency", { ms: call.latencyMs })}</span>
        {failed && <span className="text-destructive">· {t("toolFailed")}</span>}
      </summary>
      <div className="grid gap-1 border-t px-2 py-1.5">
        <span className="text-muted-foreground">{t("toolInput")}</span>
        <pre className="overflow-x-auto font-mono whitespace-pre-wrap">
          {JSON.stringify(call.input, null, 2)}
        </pre>
        {call.error && <p className="text-destructive">{call.error}</p>}
      </div>
    </details>
  );
}

export async function ConversationThread({ conversation }: { conversation: Conversation }) {
  const [t, format] = await Promise.all([getTranslations("conversations"), getFormatter()]);
  const started = new Date(conversation.createdAt);

  return (
    <section
      aria-labelledby="thread-title"
      className="flex min-h-[32rem] flex-col rounded-lg border"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div className="grid gap-0.5">
          <h2 id="thread-title" className="font-medium">
            {conversation.agent.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("startedAt", {
              date: format.dateTime(started, { dateStyle: "medium", timeStyle: "short" }),
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{t(`channels.${conversation.channel}`)}</Badge>
          <Badge variant="outline">{t(`statuses.${conversation.status}`)}</Badge>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t("totalCost", { cost: usd(format, conversation.costUsd) })}
          </span>
        </div>
      </header>

      <ol className="flex flex-1 flex-col gap-4 bg-muted/30 p-4">
        {conversation.messages.map((message) =>
          message.role === "user" ? (
            <li key={message.id} className="ml-auto grid max-w-[80%] justify-items-end gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t("visitor")}</span>
              <p className="rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                {message.content}
              </p>
            </li>
          ) : (
            <li key={message.id} className="grid max-w-[85%] gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                {message.role === "assistant"
                  ? conversation.agent.name
                  : t(`roles.${message.role}`)}
              </span>
              {message.toolCalls.length > 0 && (
                <div className="grid gap-1">
                  {message.toolCalls.map((call) => (
                    <ToolCall key={call.id} call={call} />
                  ))}
                </div>
              )}
              <p className="rounded-2xl rounded-bl-sm bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs">
                {message.content}
              </p>
              <span className="text-xs text-muted-foreground tabular-nums">
                <time dateTime={message.createdAt}>
                  {format.dateTime(new Date(message.createdAt), { timeStyle: "short" })}
                </time>
                {message.costUsd !== null && ` · ${usd(format, message.costUsd)}`}
              </span>
            </li>
          ),
        )}
      </ol>
    </section>
  );
}
