// Simplified CodeWhisperer types - core structures only

export interface CodeWhispererImage {
  format: string;
  source: {
    bytes: string;
  };
}

export interface ToolSpecification {
  name: string;
  description: string;
  inputSchema: {
    json: Record<string, unknown>;
  };
}

export interface CodeWhispererTool {
  toolSpecification: ToolSpecification;
}

export interface ToolResult {
  toolUseId: string;
  content: Array<Record<string, unknown>>;
  status: string;
  isError?: boolean;
}

export interface ToolUseEntry {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

// CodeWhisperer request structure
export interface CodeWhispererRequest {
  conversationState: {
    agentContinuationId: string;
    agentTaskType: string;
    chatTriggerType: string;
    currentMessage: {
      userInputMessage: {
        userInputMessageContext: {
          toolResults?: ToolResult[];
          tools?: CodeWhispererTool[];
        };
        content: string;
        modelId: string;
        images: CodeWhispererImage[];
        origin: string;
      };
    };
    conversationId: string;
    history: unknown[];
  };
}

// Assistant response event
export interface AssistantResponseEvent {
  conversationId?: string;
  messageId?: string;
  content: string;
  contentType?: string;
  messageStatus?: string;
  supplementaryWebLinks?: Array<{
    url: string;
    title?: string;
    snippet?: string;
    score?: number;
  }>;
  references?: unknown[];
  codeReference?: unknown[];
  followupPrompt?: {
    content: string;
    userIntent?: string;
  };
}
