"use client";

import { useEffect, useRef, useState } from "react";
import { createAgentChatParser } from "@/lib/sse";

export type ChatErrorKey = "rateLimited" | "notConfigured" | "unavailable" | "failed" | "stopped";
export type ChatTurn =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      tools: { name: string; done: boolean }[];
      usage?: { tokens: number; costUsd: number };
      error?: ChatErrorKey;
    };

const statusError: Record<number, ChatErrorKey> = { 429: "rateLimited", 503: "notConfigured" };

/**
 * One streamed agent conversation: posts a message to `url` (with `body` merged in) and
 * folds the server-sent events into turns. Shared by the dashboard test chat and the
 * public widget, which differ only in endpoint, body and how they keep the conversation id.
 */
export function useAgentChat(options: {
  url: string;
  body?: Record<string, unknown>;
  initialConversationId?: string;
  onConversation?: (conversationId: string | undefined) => void;
}) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState(options.initialConversationId);
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page cancels an in-flight reply, so no tokens are spent for nobody.
  useEffect(() => () => controller.current?.abort(), []);

  const remember = (id: string | undefined) => {
    setConversationId(id);
    options.onConversation?.(id);
  };

  const updateReply = (change: (reply: Extract<ChatTurn, { role: "assistant" }>) => void) => {
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
      const res = await fetch(options.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...options.body,
          message,
          ...(conversationId ? { conversationId } : {}),
        }),
        signal: abort.signal,
      });
      // A conversation that no longer exists for us (e.g. storage outlived it): start over.
      if (res.status === 404 && conversationId) remember(undefined);
      if (!res.ok || !res.body) {
        updateReply((r) => (r.error = statusError[res.status] ?? "failed"));
        return;
      }
      const parse = createAgentChatParser((event) => {
        switch (event.event) {
          case "start":
            remember(event.data.conversationId);
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

  return {
    turns,
    pending,
    send,
    stop: () => controller.current?.abort(),
    reset: () => {
      setTurns([]);
      remember(undefined);
    },
  };
}
