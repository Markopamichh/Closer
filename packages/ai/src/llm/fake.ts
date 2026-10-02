import type { LlmClient, LlmRequest, LlmTurn } from "./types";

export type ScriptedTurn = Partial<Omit<LlmTurn, "usage">> & { usage?: Partial<LlmTurn["usage"]> };

/**
 * A model that replays scripted turns, for tests and offline development. Streams each
 * turn's text in two chunks and records every request so tests can assert on them.
 */
export function createScriptedLlm(
  script: ScriptedTurn[] | ((request: LlmRequest) => ScriptedTurn),
) {
  const requests: LlmRequest[] = [];
  const client: LlmClient & { requests: LlmRequest[] } = {
    provider: "fake",
    requests,
    respond(request) {
      requests.push({ ...request, items: [...request.items] });
      const next = typeof script === "function" ? script(request) : script[requests.length - 1];
      if (!next) return Promise.reject(new Error(`No scripted turn #${requests.length}`));
      const text = next.text ?? "";
      if (text) {
        const half = Math.ceil(text.length / 2);
        request.onTextDelta?.(text.slice(0, half));
        request.onTextDelta?.(text.slice(half));
      }
      return Promise.resolve({
        text,
        toolCalls: next.toolCalls ?? [],
        status: next.status ?? "completed",
        model: next.model ?? request.model,
        usage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          outputTokens: 20,
          reasoningTokens: 0,
          ...next.usage,
        },
      });
    },
  };
  return client;
}
