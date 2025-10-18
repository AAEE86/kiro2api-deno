import { SSEEvent, ToolCall } from "./event_stream_types.ts";
/**
 * A parser for compliant event streams, designed to process Server-Sent Events (SSE)
 * from an upstream service. It buffers incoming data chunks and parses them into
 * structured SSE events, identifying tool calls and other event types.
 */
export class CompliantEventStreamParser {
  private buffer = "";

  public parseStream(chunk: string): { events: SSEEvent[]; toolCalls: ToolCall[] } {
    this.buffer += chunk;
    const events: SSEEvent[] = [];
    const toolCalls: ToolCall[] = [];

    let eventEndIndex;
    while ((eventEndIndex = this.buffer.indexOf("\r\n\r\n")) !== -1) {
      const eventString = this.buffer.substring(0, eventEndIndex);
      this.buffer = this.buffer.substring(eventEndIndex + 4);

      const lines = eventString.split("\r\n");
      let event: Record<string, any> = {};

      for (const line of lines) {
        if (line.startsWith("event:")) {
          event.event = line.substring(6).trim();
        } else if (line.startsWith("data:")) {
          try {
            event.data = JSON.parse(line.substring(5).trim());
          } catch (e) {
            // Ignore json parse errors
          }
        }
      }

      if (event.event && event.data) {
        events.push(event as SSEEvent);
        if (event.data.type === "tool_use") {
          toolCalls.push(event.data as ToolCall);
        }
      }
    }

    return { events, toolCalls };
  }
}
