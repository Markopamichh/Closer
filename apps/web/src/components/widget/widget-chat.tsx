"use client";

import { Loader2, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAgentChat } from "@/lib/use-agent-chat";
import { cn } from "@/lib/utils";

/**
 * Storage inside a third-party iframe can be blocked (Safari, strict modes). The chat
 * still works then; it just forgets the conversation on reload.
 */
const storage = {
  get: (key: string) => {
    try {
      return window.localStorage.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (key: string, value: string | undefined) => {
    try {
      if (value === undefined) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch {
      // Not persisted; fine.
    }
  },
};

function visitorId() {
  const key = "closer:visitor";
  const existing = storage.get(key);
  if (existing) return existing;
  const id = crypto.randomUUID();
  storage.set(key, id);
  return id;
}

export function WidgetChat({
  publicKey,
  agentName,
  businessName,
}: {
  publicKey: string;
  agentName: string;
  businessName: string;
}) {
  const t = useTranslations("widget");
  const conversationKey = `closer:conversation:${publicKey}`;
  // Read once on mount, client-only (the server render has no storage).
  const [session] = useState(() =>
    typeof window === "undefined"
      ? null
      : { visitorId: visitorId(), conversationId: storage.get(conversationKey) },
  );
  const { turns, pending, send } = useAgentChat({
    url: `/api/public/widget/${publicKey}/chat`,
    body: { visitorId: session?.visitorId },
    initialConversationId: session?.conversationId,
    onConversation: (id) => {
      storage.set(conversationKey, id);
    },
  });
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [turns]);

  function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = new FormData(form).get("message");
    if (typeof message !== "string" || message.trim() === "" || pending || !session) return;
    form.reset();
    void send(message.trim());
  }

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="grid min-w-0">
          <h1 className="truncate text-sm font-semibold">{agentName}</h1>
          <p className="truncate text-xs text-muted-foreground">{businessName}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("close")}
          // The loader on the host page listens for this and hides the iframe.
          // "*" is fine: the message carries no data, only the intent to close.
          onClick={() => {
            window.parent.postMessage({ type: "closer:close" }, "*");
          }}
        >
          <X className="size-4" aria-hidden />
        </Button>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm">
          {t("greeting", { agent: agentName, business: businessName })}
        </p>
        {turns.map((turn, index) =>
          turn.role === "user" ? (
            <p
              key={index}
              className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground"
            >
              <span className="sr-only">{t("you")}: </span>
              {turn.text}
            </p>
          ) : (
            <div key={index} className="grid max-w-[85%] gap-1">
              {(turn.text || (!turn.error && pending && index === turns.length - 1)) && (
                <p className="rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
                  {turn.text || (
                    <Loader2
                      className="size-4 animate-spin text-muted-foreground"
                      aria-label={t("typing")}
                    />
                  )}
                </p>
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
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t p-3">
        <Textarea
          name="message"
          aria-label={t("placeholder")}
          placeholder={t("placeholder")}
          rows={1}
          maxLength={2000}
          className="max-h-32 min-h-0 resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <Button type="submit" size="icon" disabled={pending} aria-label={t("send")}>
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}
