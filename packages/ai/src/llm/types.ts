/**
 * Our own, provider-neutral view of a conversation. The agent loop and the database speak
 * this; provider adapters (OpenAI today) translate it. History is append-only.
 */
export type ChatItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "tool_result"; callId: string; output: string };

export type ToolSpec = {
  name: string;
  description: string;
  /** JSON Schema of the tool input. */
  parameters: Record<string, unknown>;
};

export type LlmUsage = {
  inputTokens: number;
  /** Subset of inputTokens served from the provider's prompt cache (billed cheaper). */
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
};

export type LlmRequest = {
  model: string;
  instructions: string;
  items: ChatItem[];
  tools: ToolSpec[];
  /** False on the last round so the model has to answer in text. */
  allowTools: boolean;
  /** Groups requests that share a prompt prefix, to raise cache hit rates. */
  cacheKey?: string;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
};

export type LlmTurn = {
  text: string;
  toolCalls: { callId: string; name: string; arguments: string }[];
  usage: LlmUsage;
  /** `incomplete`: cut by the output limit; `refused`: the model declined. */
  status: "completed" | "incomplete" | "refused";
  /** Model that actually answered, as reported by the provider. */
  model: string;
};

export interface LlmClient {
  readonly provider: string;
  respond(request: LlmRequest): Promise<LlmTurn>;
}

/** Provider or transport failure. `transient` errors (rate limits, outages) can be retried. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LlmError";
  }

  get transient(): boolean {
    return this.status === undefined || this.status === 429 || this.status >= 500;
  }
}
