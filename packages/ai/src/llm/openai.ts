import OpenAI from "openai";
import type { ChatItem, LlmClient, LlmRequest, LlmTurn, ToolSpec } from "./types";
import { LlmError } from "./types";

type InputItem = OpenAI.Responses.ResponseInputItem;

function toInput(item: ChatItem): InputItem {
  switch (item.type) {
    case "user":
      return { role: "user", content: item.text };
    case "assistant":
      return { role: "assistant", content: item.text };
    case "tool_call":
      return {
        type: "function_call",
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments,
      };
    case "tool_result":
      return { type: "function_call_output", call_id: item.callId, output: item.output };
  }
}

// Not `strict`: strict mode requires every property, and our search filters are optional.
// Inputs are validated with Zod before any tool runs instead.
const toTool = (tool: ToolSpec): OpenAI.Responses.FunctionTool => ({
  type: "function",
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
  strict: false,
});

/**
 * OpenAI Responses API, streamed. `store: false`: the conversation lives in our database
 * (tenant-isolated, auditable) and is sent in full each turn, not kept by the provider.
 */
export function createOpenAiClient(options: {
  apiKey: string;
  maxOutputTokens?: number;
  /** Defaults to "minimal": in a real sales-chat test it gave the same answer as "low" at 43% of the cost. */
  reasoningEffort?: OpenAI.ReasoningEffort;
}): LlmClient {
  const client = new OpenAI({ apiKey: options.apiKey });

  return {
    provider: "openai",
    async respond(request: LlmRequest): Promise<LlmTurn> {
      let stream;
      try {
        stream = await client.responses.create(
          {
            model: request.model,
            instructions: request.instructions,
            input: request.items.map(toInput),
            tools: request.tools.map(toTool),
            tool_choice: request.allowTools ? "auto" : "none",
            store: false,
            stream: true,
            max_output_tokens: options.maxOutputTokens ?? 4096,
            reasoning: { effort: options.reasoningEffort ?? "minimal" },
            ...(request.cacheKey ? { prompt_cache_key: request.cacheKey } : {}),
          },
          { signal: request.signal },
        );
      } catch (err) {
        throw toLlmError(err);
      }

      try {
        for await (const event of stream) {
          switch (event.type) {
            case "response.output_text.delta":
              request.onTextDelta?.(event.delta);
              break;
            case "response.completed":
            case "response.incomplete":
              return toTurn(event.response, event.type === "response.incomplete");
            case "response.failed":
              throw new LlmError(event.response.error?.message ?? "The model request failed");
            case "error":
              throw new LlmError(event.message);
          }
        }
      } catch (err) {
        throw toLlmError(err);
      }
      throw new LlmError("The model stream ended without a response");
    },
  };
}

function toTurn(response: OpenAI.Responses.Response, incomplete: boolean): LlmTurn {
  const toolCalls: LlmTurn["toolCalls"] = [];
  const text: string[] = [];
  let refused = false;
  // Built from the output items: `output_text` is a convenience the SDK only fills on
  // non-streamed responses; it is undefined on the streamed `response.completed` event.
  for (const item of response.output) {
    if (item.type === "function_call") {
      toolCalls.push({ callId: item.call_id, name: item.name, arguments: item.arguments });
    } else if (item.type === "message") {
      for (const part of item.content) {
        if (part.type === "output_text") text.push(part.text);
        else refused = true;
      }
    }
  }
  const usage = response.usage;
  return {
    text: text.join(""),
    toolCalls,
    usage: {
      inputTokens: usage?.input_tokens ?? 0,
      cachedInputTokens: usage?.input_tokens_details.cached_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      reasoningTokens: usage?.output_tokens_details.reasoning_tokens ?? 0,
    },
    status: refused ? "refused" : incomplete ? "incomplete" : "completed",
    model: response.model,
  };
}

function toLlmError(err: unknown): unknown {
  if (err instanceof LlmError) return err;
  // Aborts are the caller's own cancellation, not a provider failure.
  if (err instanceof OpenAI.APIUserAbortError) return err;
  if (err instanceof OpenAI.APIError) {
    // Only the status and a short message: provider bodies can echo the request.
    const status: unknown = err.status;
    const code = typeof status === "number" ? status : undefined;
    return new LlmError(`OpenAI request failed with status ${String(code)}`, code);
  }
  return err;
}
