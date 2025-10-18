import type { ToolExecution } from "../types/common.ts";

export interface ParsedEvent {
  type: string;
  data: any;
  timestamp: number;
}

export interface ParseResult {
  events: ParsedEvent[];
  content: string;
  toolCalls: ToolExecution[];
  stopReason: string;
  usage: { inputTokens: number; outputTokens: number };
}

export class CompliantEventStreamParser {
  private buffer = new Uint8Array(0);
  private events: ParsedEvent[] = [];
  private content = "";
  private toolCalls: ToolExecution[] = [];
  private outputTokens = 0;

  parseStream(chunk: Uint8Array): ParsedEvent[] {
    // Append to buffer
    const newBuffer = new Uint8Array(this.buffer.length + chunk.length);
    newBuffer.set(this.buffer);
    newBuffer.set(chunk, this.buffer.length);
    this.buffer = newBuffer;

    const events: ParsedEvent[] = [];

    // Parse complete messages
    while (this.buffer.length >= 16) {
      const totalLength = new DataView(this.buffer.buffer, this.buffer.byteOffset, 4).getUint32(0, false);
      
      if (this.buffer.length < totalLength) break;

      const headerLength = new DataView(this.buffer.buffer, this.buffer.byteOffset + 4, 4).getUint32(0, false);
      const payloadStart = 12 + headerLength;
      const payloadEnd = totalLength - 4;
      
      if (payloadEnd > payloadStart) {
        const payloadData = this.buffer.slice(payloadStart, payloadEnd);
        const event = this.parsePayload(payloadData);
        if (event) {
          events.push(event);
          this.events.push(event);
        }
      }

      this.buffer = this.buffer.slice(totalLength);
    }

    return events;
  }

  private parsePayload(payload: Uint8Array): ParsedEvent | null {
    try {
      const data = JSON.parse(new TextDecoder().decode(payload));
      const event: ParsedEvent = {
        type: this.determineEventType(data),
        data,
        timestamp: Date.now(),
      };

      // Process content
      if (data.content) {
        this.content += data.content;
        this.outputTokens += Math.ceil(data.content.length / 4);
      }

      // Process tool calls
      if (data.toolUse) {
        this.toolCalls.push({
          id: data.toolUse.toolUseId || crypto.randomUUID(),
          name: data.toolUse.name,
          input: data.toolUse.input || {},
          status: "completed",
        });
      }

      return event;
    } catch {
      return null;
    }
  }

  private determineEventType(data: any): string {
    if (data.content) return "content";
    if (data.toolUse) return "tool_use";
    if (data.error) return "error";
    return "unknown";
  }

  getResult(): ParseResult {
    return {
      events: this.events,
      content: this.content,
      toolCalls: this.toolCalls,
      stopReason: "end_turn",
      usage: {
        inputTokens: 0,
        outputTokens: this.outputTokens,
      },
    };
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
    this.events = [];
    this.content = "";
    this.toolCalls = [];
    this.outputTokens = 0;
  }
}