/**
 * 类型定义模块
 * 定义项目中使用的所有数据结构
 */

// ============================================================================
// 认证相关类型
// ============================================================================

export type AuthType = "Social" | "IdC";

export interface AuthConfig {
  auth: AuthType;
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
  disabled?: boolean;
  description?: string;
}

export interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface TokenInfo {
  configIndex: number;
  config: AuthConfig;
  cachedToken?: CachedToken;
  lastRefreshTime?: number;
  refreshing: boolean;
}

// ============================================================================
// Anthropic API 类型
// ============================================================================

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ImageBlock {
  type: "image";
  source: {
    type: "base64" | "url";
    media_type: string;
    data: string;
  };
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  stream?: boolean;
  system?: string;
  tools?: Tool[];
  tool_choice?: ToolChoice;
  metadata?: Record<string, unknown>;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolChoice {
  type: "auto" | "any" | "tool";
  name?: string;
}

export interface AnthropicResponse {
  id: string;
  type: "message";
  role: "assistant";
  content: ContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: {
    type: string;
    text?: string;
    stop_reason?: string;
  };
  content_block?: ContentBlock;
  message?: Partial<AnthropicResponse>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

// ============================================================================
// OpenAI API 类型
// ============================================================================

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  name?: string;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  stream?: boolean;
  stop?: string | string[];
  tools?: OpenAITool[];
  tool_choice?: "none" | "auto" | { type: "function"; function: { name: string } };
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OpenAIResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: OpenAIMessage;
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIStreamChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<OpenAIMessage>;
    finish_reason: string | null;
  }>;
}

// ============================================================================
// CodeWhisperer API 类型
// ============================================================================

export interface CodeWhispererRequest {
  conversationState: {
    conversationId?: string;
    history?: CodeWhispererMessage[];
    currentMessage: {
      userInputMessage: {
        content: string;
        userInputMessageContext?: {
          editorState?: {
            document?: {
              text: string;
              relativeFilePath: string;
              programmingLanguage: {
                languageName: string;
              };
            };
          };
        };
      };
      userIntent?: string;
    };
    chatTriggerType: string;
    customizationArn?: string;
  };
  profileArn?: string;
}

export interface CodeWhispererMessage {
  userInputMessage?: {
    content: string;
  };
  assistantResponseMessage?: {
    content: string;
  };
}

export interface CodeWhispererResponse {
  conversationId: string;
  $responseStream?: ReadableStream<Uint8Array>;
}

export interface CodeWhispererStreamEvent {
  messageMetadataEvent?: {
    conversationId: string;
  };
  assistantResponseEvent?: {
    content: string;
  };
  codeReferenceEvent?: {
    references: Array<{
      licenseName: string;
      repository: string;
      recommendationContentSpan: {
        start: number;
        end: number;
      };
    }>;
  };
  supplementaryWebLinksEvent?: {
    supplementaryWebLinks: Array<{
      url: string;
      title: string;
      snippet: string;
    }>;
  };
  followupPromptEvent?: {
    followupPrompt: {
      content: string;
    };
  };
  error?: {
    message: string;
  };
}

// ============================================================================
// 使用限制类型
// ============================================================================

export interface UsageLimits {
  maxMessages?: number;
  remainingMessages?: number;
  resetAt?: string;
}

// ============================================================================
// 配置类型
// ============================================================================

export interface AppConfig {
  port: number;
  clientToken: string;
  authConfigs: AuthConfig[];
  logLevel: "debug" | "info" | "warn" | "error";
  logFormat: "text" | "json";
  ginMode: "debug" | "release" | "test";
}

// ============================================================================
// 模型映射类型
// ============================================================================

export interface ModelMapping {
  publicName: string;
  internalId: string;
  aliases?: string[];
}

// ============================================================================
// HTTP 相关类型
// ============================================================================

export interface ErrorResponse {
  error: {
    type: string;
    message: string;
  };
}

export interface ModelsResponse {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created: number;
    owned_by: string;
  }>;
}

// ============================================================================
// Token 池状态类型
// ============================================================================

export interface TokenPoolStatus {
  total: number;
  available: number;
  tokens: Array<{
    index: number;
    auth: AuthType;
    disabled: boolean;
    cached: boolean;
    expiresIn?: number;
    lastRefresh?: number;
    usageLimits?: UsageLimits;
  }>;
}
