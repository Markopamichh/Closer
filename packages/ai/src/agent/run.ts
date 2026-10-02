import { z } from "zod";
import type { ChatItem, LlmClient, LlmTurn, ToolSpec } from "../llm/types";

export type AgentTool<Input = unknown> = {
  name: string;
  description: string;
  input: z.ZodType<Input>;
  execute: (input: Input, signal?: AbortSignal) => Promise<unknown>;
};

/** Erases the input type so tools with different inputs fit in one list. */
export const defineTool = <Input>(tool: AgentTool<Input>): AgentTool => ({
  ...tool,
  execute: (input, signal) => tool.execute(input as Input, signal),
});

export type ToolCallRecord = {
  callId: string;
  name: string;
  input: unknown;
  output: unknown;
  status: "success" | "error";
  error?: string;
  latencyMs: number;
};

export type AgentEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; name: string }
  | { type: "tool_end"; name: string; ok: boolean };

export type AgentRun = {
  /** Items to append to the conversation, in order (tool calls, results, final answer). */
  newItems: ChatItem[];
  text: string;
  /** One entry per model request, for tracing and cost. */
  turns: (LlmTurn & { latencyMs: number })[];
  toolCalls: ToolCallRecord[];
  status: LlmTurn["status"];
};

export const MAX_TOOL_ROUNDS = 5;

function toolSpec(tool: AgentTool): ToolSpec {
  const parameters: Record<string, unknown> = { ...z.toJSONSchema(tool.input) };
  delete parameters.$schema;
  return { name: tool.name, description: tool.description, parameters };
}

/** Tool output goes back to the model as data; errors too, so it can recover. */
const serialize = (value: unknown) => JSON.stringify(value);

async function runTool(
  tool: AgentTool | undefined,
  call: { callId: string; name: string; arguments: string },
  signal?: AbortSignal,
): Promise<ToolCallRecord> {
  const started = performance.now();
  const record = (fields: Omit<ToolCallRecord, "callId" | "name" | "latencyMs">) => ({
    callId: call.callId,
    name: call.name,
    latencyMs: Math.round(performance.now() - started),
    ...fields,
  });

  let raw: unknown;
  try {
    raw = JSON.parse(call.arguments);
  } catch {
    return record({
      input: call.arguments,
      output: null,
      status: "error",
      error: "Arguments are not valid JSON",
    });
  }
  if (!tool) {
    return record({
      input: raw,
      output: null,
      status: "error",
      error: `Unknown tool "${call.name}"`,
    });
  }
  // The model's arguments are untrusted input, like any request body.
  const parsed = tool.input.safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return record({
      input: raw,
      output: null,
      status: "error",
      error: `Invalid arguments: ${error}`,
    });
  }
  try {
    const output = await tool.execute(parsed.data, signal);
    return record({ input: parsed.data, output, status: "success" });
  } catch (err) {
    if (signal?.aborted) throw err;
    return record({ input: parsed.data, output: null, status: "error", error: "The tool failed" });
  }
}

/**
 * The agent loop: ask the model, run the tools it calls (in parallel), feed the results
 * back, repeat. The last allowed round disables tools so a reply always ends in text.
 */
export async function runAgent(options: {
  llm: LlmClient;
  model: string;
  instructions: string;
  history: ChatItem[];
  tools: AgentTool[];
  cacheKey?: string;
  signal?: AbortSignal;
  maxToolRounds?: number;
  onEvent?: (event: AgentEvent) => void;
}): Promise<AgentRun> {
  const { llm, tools, signal, onEvent } = options;
  const maxRounds = options.maxToolRounds ?? MAX_TOOL_ROUNDS;
  const byName = new Map(tools.map((t) => [t.name, t]));
  const specs = tools.map(toolSpec);
  const newItems: ChatItem[] = [];
  const turns: AgentRun["turns"] = [];
  const toolCalls: ToolCallRecord[] = [];

  for (let round = 0; ; round++) {
    const allowTools = round < maxRounds && specs.length > 0;
    const started = performance.now();
    const turn = await llm.respond({
      model: options.model,
      instructions: options.instructions,
      items: [...options.history, ...newItems],
      tools: specs,
      allowTools,
      cacheKey: options.cacheKey,
      signal,
      onTextDelta: (delta) => onEvent?.({ type: "text_delta", delta }),
    });
    turns.push({ ...turn, latencyMs: Math.round(performance.now() - started) });

    if (turn.toolCalls.length === 0 || !allowTools || turn.status !== "completed") {
      if (turn.text) newItems.push({ type: "assistant", text: turn.text });
      return { newItems, text: turn.text, turns, toolCalls, status: turn.status };
    }

    if (turn.text) newItems.push({ type: "assistant", text: turn.text });
    for (const call of turn.toolCalls) {
      newItems.push({ type: "tool_call", ...call });
      onEvent?.({ type: "tool_start", name: call.name });
    }
    const results = await Promise.all(
      turn.toolCalls.map((call) => runTool(byName.get(call.name), call, signal)),
    );
    for (const result of results) {
      toolCalls.push(result);
      onEvent?.({ type: "tool_end", name: result.name, ok: result.status === "success" });
      newItems.push({
        type: "tool_result",
        callId: result.callId,
        output: serialize(result.status === "success" ? result.output : { error: result.error }),
      });
    }
  }
}
