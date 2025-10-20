import type { ContentType, MessageStatus, UserIntent } from "./codewhisperer_enums.ts";

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

// History user message
export interface HistoryUserMessage {
  userInputMessage: {
    content: string;
    modelId: string;
    origin: string;
    images?: CodeWhispererImage[];
    userInputMessageContext: {
      toolResults?: ToolResult[];
      tools?: CodeWhispererTool[];
    };
  };
}

// History assistant message
export interface HistoryAssistantMessage {
  assistantResponseMessage: {
    content: string;
    toolUses: ToolUseEntry[];
  };
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

// CodeWhisperer event
export interface CodeWhispererEvent {
  "content-type": string;
  "message-type": string;
  content: string;
  "event-type": string;
}

// Content span
export interface ContentSpan {
  start: number;
  end: number;
}

// Supplementary web link
export interface SupplementaryWebLink {
  url: string;
  title?: string;
  snippet?: string;
  score?: number;
}

// Most relevant missed alternative
export interface MostRelevantMissedAlternative {
  url: string;
  licenseName?: string;
  repository?: string;
}

// Reference
export interface Reference {
  licenseName?: string;
  repository?: string;
  url?: string;
  information?: string;
  recommendationContentSpan?: ContentSpan;
  mostRelevantMissedAlternative?: MostRelevantMissedAlternative;
}

// Followup prompt
export interface FollowupPrompt {
  content: string;
  userIntent?: UserIntent;
}

// Programming language
export interface ProgrammingLanguage {
  languageName: string;
}

// Customization
export interface Customization {
  arn: string;
  name?: string;
}

// Code query
export interface CodeQuery {
  codeQueryId: string;
  programmingLanguage?: ProgrammingLanguage;
  userInputMessageId?: string;
}

// AWS CodeWhisperer assistant response event complete structure
export interface AssistantResponseEvent {
  // Core fields
  conversationId: string;
  messageId: string;
  content: string;
  contentType?: ContentType;
  messageStatus?: MessageStatus;

  // Reference and link fields
  supplementaryWebLinks?: SupplementaryWebLink[];
  references?: Reference[];
  codeReference?: Reference[];

  // Interaction fields
  followupPrompt?: FollowupPrompt;

  // Context fields
  programmingLanguage?: ProgrammingLanguage;
  customizations?: Customization[];
  userIntent?: UserIntent;
  codeQuery?: CodeQuery;
}

// Validation function
export function validateAssistantResponseEvent(
  event: Partial<AssistantResponseEvent>
): boolean {
  // For streaming responses, only content is required
  if (!event.conversationId && !event.messageId && event.content) {
    return true;
  }

  // For tool call events, only tool fields are required
  if (!event.conversationId && !event.messageId && event.codeQuery) {
    return true;
  }

  // Check if has any valid content
  const hasValidContent = !!(event.content ||
    event.codeQuery ||
    event.supplementaryWebLinks?.length ||
    event.references?.length ||
    event.codeReference?.length ||
    event.followupPrompt);

  if (hasValidContent) {
    return true;
  }

  // Complete response requires all required fields
  if (!hasValidContent) {
    if (!event.conversationId || !event.messageId) {
      return false;
    }
  }

  return true;
}
