import { SSEEvent, ToolExecution } from "./event_stream_types.ts";
import { RobustEventStreamParser } from "./robust_parser.ts";
import { MessageProcessor } from "./message_processor.ts";
import { SessionInfo } from "./session_manager.ts";

export interface ParseResult {
  messages: any[];
  events: SSEEvent[];
  toolExecutions: Map<string, ToolExecution>;
  activeTools: Map<string, ToolExecution>;
  sessionInfo: SessionInfo;
  summary: ParseSummary;
  errors: Error[];
}

export interface ParseSummary {
  totalMessages: number;
  totalEvents: number;
  messageTypes: Record<string, number>;
  eventTypes: Record<string, number>;
  hasToolCalls: boolean;
  hasCompletions: boolean;
  hasErrors: boolean;
  hasSessionEvents: boolean;
  toolSummary: Record<string, any>;
}

export class EnhancedEventStreamParser {
  private robustParser: RobustEventStreamParser;
  private messageProcessor: MessageProcessor;

  constructor() {
    this.robustParser = new RobustEventStreamParser();
    this.messageProcessor = new MessageProcessor();
  }

  setMaxErrors(maxErrors: number): void {
    this.robustParser.setMaxErrors(maxErrors);
  }

  reset(): void {
    this.robustParser.reset();
    this.messageProcessor.reset();
  }

  parseResponse(streamData: Uint8Array): ParseResult {
    const messages = this.robustParser.parseStream(streamData);
    const allEvents: SSEEvent[] = [];
    const errors: Error[] = [];

    for (const message of messages) {
      try {
        const events = this.messageProcessor.processMessage(message);
        allEvents.push(...events);
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }

    const toolManager = this.messageProcessor.getToolManager();
    const sessionManager = this.messageProcessor.getSessionManager();

    return {
      messages,
      events: allEvents,
      toolExecutions: toolManager.getCompletedTools(),
      activeTools: toolManager.getActiveTools(),
      sessionInfo: sessionManager.getSessionInfo(),
      summary: this.generateSummary(messages, allEvents, toolManager),
      errors,
    };
  }

  parseStream(data: Uint8Array): SSEEvent[] {
    const messages = this.robustParser.parseStream(data);
    const allEvents: SSEEvent[] = [];

    for (const message of messages) {
      try {
        const events = this.messageProcessor.processMessage(message);
        allEvents.push(...events);
      } catch {
        // Ignore errors in streaming mode
      }
    }

    return allEvents;
  }

  private generateSummary(
    messages: any[],
    events: SSEEvent[],
    toolManager: any
  ): ParseSummary {
    const summary: ParseSummary = {
      totalMessages: messages.length,
      totalEvents: events.length,
      messageTypes: {},
      eventTypes: {},
      hasToolCalls: false,
      hasCompletions: false,
      hasErrors: false,
      hasSessionEvents: false,
      toolSummary: {},
    };

    for (const message of messages) {
      const msgType = message.messageType;
      summary.messageTypes[msgType] = (summary.messageTypes[msgType] || 0) + 1;

      if (msgType === "error" || msgType === "exception") {
        summary.hasErrors = true;
      }

      const eventType = message.eventType;
      if (eventType) {
        summary.eventTypes[eventType] = (summary.eventTypes[eventType] || 0) + 1;

        if (eventType.includes("tool") || eventType.includes("Tool")) {
          summary.hasToolCalls = true;
        }
        if (eventType.includes("completion") || eventType.includes("Completion")) {
          summary.hasCompletions = true;
        }
        if (eventType.includes("session") || eventType.includes("Session")) {
          summary.hasSessionEvents = true;
        }
      }
    }

    for (const event of events) {
      summary.eventTypes[event.event] = (summary.eventTypes[event.event] || 0) + 1;

      if (event.event === "content_block_start" || event.event === "content_block_stop") {
        const data = event.data as any;
        if (data?.content_block?.type === "tool_use") {
          summary.hasToolCalls = true;
        }
      }
    }

    summary.toolSummary = toolManager.generateToolSummary();

    return summary;
  }

  getToolManager() {
    return this.messageProcessor.getToolManager();
  }

  getCompletionText(result: ParseResult): string {
    let text = "";
    for (const event of result.events) {
      if (event.event === "content_block_delta") {
        const data = event.data as any;
        if (data?.delta?.text) {
          text += data.delta.text;
        }
      }
    }
    return text;
  }

  getToolCalls(result: ParseResult): ToolExecution[] {
    return [
      ...Array.from(result.toolExecutions.values()),
      ...Array.from(result.activeTools.values()),
    ];
  }
}
