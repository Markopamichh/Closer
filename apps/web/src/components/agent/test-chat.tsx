"use client";

import { Loader2, RotateCcw, Search, Send, Square } from "lucide-react";
import { useFormatter, useMessages, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { createAgentChatParser } from "@/lib/sse";
import { cn } from "@/lib/utils";

type ErrorKey = "rateLimited" | "notConfigured" | "unavailable" | "failed" | "stopped";
type Turn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      tools: { name: string; done: boolean }[];
      usage?: { tokens: number; costUsd: number };
      error?: ErrorKey;
    };

const statusError: Record<number, ErrorKey> = { 429: "rateLimited", 503: "notConfigured" };

export function TestChat({
  orgId,
  agentId,
  agentName,
}: {
  orgId: string;
  agentId: string;
  agentName: string;
}) {
  const t = useTranslations("agentPage");
  const format = useFormatter();
  // Widened on purpose: tool names come from the server at runtime.
  const toolLabels: Record<string, string | undefined> = useMessages().agentPage.tools;
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  // Leaving the page cancels an in-flight reply, so no tokens are spent for nobody.
  useEffect(() => () => controller.current?.abort(), []);

  const updateReply = (change: (reply: Extract<Turn, { role: "assistant" }>) => void) => {
    setTurns((current) => {
      const next = [...current];
      const last = next.at(-1);
      if (last?.role === "assistant") {
        const copy = { ...last, tools: [...last.tools] };
        change(copy);
        next[next.length - 1] = copy;
      }
      return next;
    });
  };

  async function send(message: string) {
    const abort = new AbortController();
    controller.current = abort;
    setPending(true);
    setTurns((current) => [
      ...current,
      { role: "user", text: message },
      { role: "assistant", text: "", tools: [] },
    ]);
    try {
      const res = await fetch(
        `/api/organizations/${encodeURIComponent(orgId)}/agents/${agentId}/test-chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
          signal: abort.signal,
        },
      );
      if (!res.ok || !res.body) {
        updateReply((r) => (r.error = statusError[res.status] ?? "failed"));
        return;
      }
      const parse = createAgentChatParser((event) => {
        switch (event.event) {
          case "start":
            setConversationId(event.data.conversationId);
            break;
          case "delta":
            updateReply((r) => (r.text += event.data.text));
            break;
          case "tool":
            updateReply((r) => {
              if (event.data.phase === "start")
                r.tools.push({ name: event.data.name, done: false });
              else {
                const tool = r.tools.find((x) => x.name === event.data.name && !x.done);
                if (tool) tool.done = true;
              }
            });
            break;
          case "done":
            updateReply((r) => {
              const u = event.data.usage;
              r.usage = { tokens: u.inputTokens + u.outputTokens, costUsd: u.costUsd };
            });
            break;
          case "error":
            updateReply((r) => (r.error = event.data.code));
            break;
        }
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parse(value);
      }
    } catch {
      updateReply((r) => (r.error = abort.signal.aborted ? "stopped" : "failed"));
    } finally {
      setPending(false);
      controller.current = null;
    }
  }

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = new FormData(form).get("message");
    if (typeof message !== "string" || message.trim() === "" || pending) return;
    form.reset();
    void send(message.trim());
  }

  return (
    <Card className="flex min-h-[32rem] flex-col">
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="grid gap-1.5">
          <CardTitle>{t("chatTitle")}</CardTitle>
          <CardDescription>{t("chatDescription")}</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending || turns.length === 0}
          onClick={() => {
            setTurns([]);
            setConversationId(undefined);
          }}
        >
          <RotateCcw className="size-4" aria-hidden />
          {t("newConversation")}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <div
          className="flex max-h-[28rem] flex-1 flex-col gap-3 overflow-y-auto rounded-lg border bg-muted/30 p-4"
          aria-live="polite"
        >
          {turns.length === 0 && (
            <p className="m-auto max-w-sm text-center text-sm text-muted-foreground">
              {t("empty")}
            </p>
          )}
          {turns.map((turn, index) =>
            turn.role === "user" ? (
              <div
                key={index}
                className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
              >
                <span className="sr-only">{t("you")}: </span>
                {turn.text}
              </div>
            ) : (
              <div key={index} className="grid max-w-[85%] gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{agentName}</span>
                {turn.tools.map((tool, i) => (
                  <span key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    {tool.done ? (
                      <Search className="size-3" aria-hidden />
                    ) : (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    )}
                    {toolLabels[tool.name] ?? tool.name}
                  </span>
                ))}
                {(turn.text || (!turn.error && pending && index === turns.length - 1)) && (
                  <div className="rounded-2xl rounded-bl-sm bg-background px-3 py-2 text-sm whitespace-pre-wrap shadow-xs">
                    {turn.text || (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
                    )}
                  </div>
                )}
                {turn.error && (
                  <p
                    role="alert"
                    className={cn(
                      "text-xs",
                      turn.error === "stopped" ? "text-muted-foreground" : "text-destructive",
                    )}
                  >
                    {t(`errors.${turn.error}`)}
                  </p>
                )}
                {turn.usage && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("usage", {
                      tokens: format.number(turn.usage.tokens),
                      cost: format.number(turn.usage.costUsd, {
                        style: "currency",
                        currency: "USD",
                        maximumSignificantDigits: 2,
                      }),
                    })}
                  </span>
                )}
              </div>
            ),
          )}
          <div ref={bottom} />
        </div>
        <form onSubmit={onSubmit} className="flex items-end gap-2">
          <Textarea
            name="message"
            placeholder={t("placeholder")}
            rows={2}
            maxLength={2000}
            className="min-h-0 resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
          />
          {pending ? (
            <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>
              <Square className="size-4" aria-hidden />
              {t("stop")}
            </Button>
          ) : (
            <Button type="submit">
              <Send className="size-4" aria-hidden />
              {t("send")}
            </Button>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
