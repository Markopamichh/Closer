import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentEvent, AgentTool } from "../src/agent/run";
import { defineTool, runAgent } from "../src/agent/run";
import { createScriptedLlm } from "../src/llm/fake";

const findCars = vi.fn((input: { maxPrice?: number }) =>
  Promise.resolve([{ title: "Hilux 2021", price: input.maxPrice ?? 0 }]),
);
const tools: AgentTool[] = [
  defineTool({
    name: "search_inventory",
    description: "Search available items",
    input: z.object({ maxPrice: z.number().int().positive().optional() }),
    execute: findCars,
  }),
  defineTool({
    name: "explode",
    description: "Always fails",
    input: z.object({}),
    execute: () => Promise.reject(new Error("db password is hunter2")),
  }),
];

const call = (name: string, args: unknown, callId = `call_${name}`) => ({
  callId,
  name,
  arguments: JSON.stringify(args),
});

const run = (
  script: Parameters<typeof createScriptedLlm>[0],
  extra: { maxToolRounds?: number } = {},
) => {
  const llm = createScriptedLlm(script);
  const events: AgentEvent[] = [];
  const result = runAgent({
    llm,
    model: "test-model",
    instructions: "You sell cars.",
    history: [{ type: "user", text: "Any trucks under 25k?" }],
    tools,
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return { llm, events, result };
};

describe("runAgent", () => {
  it("answers directly and streams the text", async () => {
    const { result, events, llm } = run([{ text: "Hello! How can I help?" }]);
    const out = await result;
    expect(out.newItems).toEqual([{ type: "assistant", text: "Hello! How can I help?" }]);
    const streamed = events.flatMap((e) => (e.type === "text_delta" ? [e.delta] : [])).join("");
    expect(streamed).toBe("Hello! How can I help?");
    expect(llm.requests[0]?.allowTools).toBe(true);
  });

  it("runs a tool with validated input and feeds the result back", async () => {
    const { result, llm } = run([
      { text: "Let me check.", toolCalls: [call("search_inventory", { maxPrice: 25000 })] },
      { text: "We have a Hilux 2021." },
    ]);
    const out = await result;

    expect(findCars).toHaveBeenCalledWith({ maxPrice: 25000 }, undefined);
    expect(out.newItems.map((i) => i.type)).toEqual([
      "assistant",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(out.toolCalls[0]).toMatchObject({ name: "search_inventory", status: "success" });
    // The second request carries the call and its result.
    const second = llm.requests[1]?.items.at(-1);
    expect(second).toMatchObject({ type: "tool_result", callId: "call_search_inventory" });
    expect(JSON.parse(second?.type === "tool_result" ? second.output : "null")).toEqual([
      { title: "Hilux 2021", price: 25000 },
    ]);
    expect(out.turns).toHaveLength(2);
  });

  it.each([
    ["invalid arguments", call("search_inventory", { maxPrice: -5 }), /Invalid arguments/],
    [
      "arguments that are not JSON",
      { callId: "c1", name: "search_inventory", arguments: "{oops" },
      /not valid JSON/,
    ],
    ["an unknown tool", call("delete_everything", {}), /Unknown tool/],
  ])(
    "returns %s to the model as an error without running anything",
    async (_label, badCall, error) => {
      findCars.mockClear();
      const { result } = run([{ toolCalls: [badCall] }, { text: "Sorry, let me try again." }]);
      const out = await result;
      expect(findCars).not.toHaveBeenCalled();
      expect(out.toolCalls[0]).toMatchObject({
        status: "error",
        error: expect.stringMatching(error) as unknown,
      });
      expect(out.text).toBe("Sorry, let me try again.");
    },
  );

  it("hides a tool's internal error from the model", async () => {
    const { result } = run([
      { toolCalls: [call("explode", {})] },
      { text: "Something went wrong." },
    ]);
    const out = await result;
    const fed = out.newItems.find((i) => i.type === "tool_result");
    expect(fed?.type === "tool_result" && fed.output).toBe(
      JSON.stringify({ error: "The tool failed" }),
    );
    expect(JSON.stringify(out.newItems)).not.toContain("hunter2");
  });

  it("runs parallel calls and returns every result", async () => {
    const { result } = run([
      {
        toolCalls: [
          call("search_inventory", { maxPrice: 1 }, "a"),
          call("search_inventory", { maxPrice: 2 }, "b"),
        ],
      },
      { text: "Done." },
    ]);
    const out = await result;
    expect(out.newItems.map((i) => (i.type === "tool_result" ? i.callId : i.type))).toEqual([
      "tool_call",
      "tool_call",
      "a",
      "b",
      "assistant",
    ]);
  });

  it("stops offering tools after the round limit, so the reply ends in text", async () => {
    const { result, llm } = run(
      (request) =>
        request.allowTools
          ? { toolCalls: [call("search_inventory", {})] }
          : { text: "Here is what I found." },
      { maxToolRounds: 2 },
    );
    const out = await result;
    expect(llm.requests.map((r) => r.allowTools)).toEqual([true, true, false]);
    expect(out.text).toBe("Here is what I found.");
  });

  it("does not run tools from a reply that was cut off", async () => {
    findCars.mockClear();
    const { result } = run([{ status: "incomplete", toolCalls: [call("search_inventory", {})] }]);
    const out = await result;
    expect(findCars).not.toHaveBeenCalled();
    expect(out.status).toBe("incomplete");
  });
});
