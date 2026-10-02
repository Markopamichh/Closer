import { describe, expect, it } from "vitest";
import type { AgentChatEvent } from "./sse";
import { createAgentChatParser } from "./sse";

const START = 'event: start\ndata: {"conversationId":"7b1e3c1a-2f5e-4a7b-9c4d-0e1f2a3b4c5d"}\n\n';
const DELTA = (text: string) => `event: delta\ndata: ${JSON.stringify({ text })}\n\n`;

function parse(chunks: string[]) {
  const events: AgentChatEvent[] = [];
  const feed = createAgentChatParser((e) => events.push(e));
  for (const chunk of chunks) feed(chunk);
  return events;
}

describe("createAgentChatParser", () => {
  it("parses several events arriving in one chunk", () => {
    expect(parse([START + DELTA("Hola") + DELTA(" mundo")]).map((e) => e.event)).toEqual([
      "start",
      "delta",
      "delta",
    ]);
  });

  it("reassembles an event split at any byte", () => {
    const stream = START + DELTA("¡Tenemos 2 autos!");
    for (let cut = 1; cut < stream.length; cut++) {
      const events = parse([stream.slice(0, cut), stream.slice(cut)]);
      expect(events.map((e) => e.event)).toEqual(["start", "delta"]);
      expect(events[1]).toEqual({ event: "delta", data: { text: "¡Tenemos 2 autos!" } });
    }
  });

  it("accepts CRLF line endings", () => {
    expect(parse([DELTA("x").replaceAll("\n", "\r\n")])).toEqual([
      { event: "delta", data: { text: "x" } },
    ]);
  });

  it("drops unknown events and payloads that fail the schema", () => {
    const events = parse([
      'event: surprise\ndata: {"a":1}\n\n',
      'event: delta\ndata: {"text": 42}\n\n',
      "event: delta\ndata: not json\n\n",
      DELTA("ok"),
    ]);
    expect(events).toEqual([{ event: "delta", data: { text: "ok" } }]);
  });

  it("waits for the blank line before dispatching", () => {
    expect(parse(['event: delta\ndata: {"text":"partial"}\n'])).toEqual([]);
  });
});
