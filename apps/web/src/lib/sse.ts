import type { AgentChatEventName } from "@closer/shared";
import { agentChatEventSchemas } from "@closer/shared";
import type { z } from "zod";

export type AgentChatEvent = {
  [K in AgentChatEventName]: { event: K; data: z.infer<(typeof agentChatEventSchemas)[K]> };
}[AgentChatEventName];

const isEventName = (name: string): name is AgentChatEventName => name in agentChatEventSchemas;

/**
 * Incremental server-sent-events parser. The network splits the stream at arbitrary
 * points, so a chunk may end mid-line or carry several events; state is kept between
 * chunks. Unknown events and payloads that fail their schema are dropped.
 */
export function createAgentChatParser(onEvent: (event: AgentChatEvent) => void) {
  let buffer = "";
  let eventName = "message";
  let data: string[] = [];

  const dispatch = () => {
    if (data.length > 0 && isEventName(eventName)) {
      let payload: unknown;
      try {
        payload = JSON.parse(data.join("\n"));
      } catch {
        payload = undefined;
      }
      const parsed = agentChatEventSchemas[eventName].safeParse(payload);
      if (parsed.success) onEvent({ event: eventName, data: parsed.data } as AgentChatEvent);
    }
    eventName = "message";
    data = [];
  };

  return (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "") dispatch();
      else if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
  };
}
