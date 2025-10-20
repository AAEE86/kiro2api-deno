import type { AnthropicRequest } from "../types/anthropic.ts";
import type { OpenAIRequest } from "../types/openai.ts";
import type { CodeWhispererRequest } from "../types/codewhisperer.ts";
import type { ContentBlock } from "../types/common.ts";
import { DEFAULTS, MODEL_MAP } from "../config/constants.ts";
import * as logger from "../logger/logger.ts";
import { validateAndProcessTools, convertOpenAIToolChoiceToAnthropic } from "./tools.ts";

export { convertAnthropicToOpenAI } from "./openai.ts";

// Validate CodeWhisperer request structure
// Match Go implementation in converter/codewhisperer.go:47-87
function validateCodeWhispererRequest(cwReq: CodeWhispererRequest): void {
  // Validate required fields
  if (!cwReq.conversationState.currentMessage.userInputMessage.modelId) {
    throw new Error("ModelId cannot be empty");
  }

  if (!cwReq.conversationState.conversationId) {
    throw new Error("ConversationId cannot be empty");
  }

  // Validate content completeness
  const trimmedContent = cwReq.conversationState.currentMessage.userInputMessage.content.trim();
  const hasImages = cwReq.conversationState.currentMessage.userInputMessage.images.length > 0;
  const hasTools = (cwReq.conversationState.currentMessage.userInputMessage.userInputMessageContext
    .tools?.length || 0) > 0;
  const hasToolResults = (cwReq.conversationState.currentMessage.userInputMessage
    .userInputMessageContext.toolResults?.length || 0) > 0;

  // If has tool results, allow empty content (tool execution feedback)
  if (hasToolResults) {
    logger.debug(
      "检测到工具结果，允许空内容",
      logger.Int(
        "tool_result_count",
        cwReq.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults
          ?.length || 0,
      ),
    );
    return;
  }

  // If no content but has tools, inject placeholder
  if (!trimmedContent && !hasImages && hasTools) {
    cwReq.conversationState.currentMessage.userInputMessage.content = "执行工具任务";
    logger.warn("注入占位符内容以触发工具调用");
    return;
  }

  // Validate at least has content or images
  if (!trimmedContent && !hasImages) {
    throw new Error("User message content and images are both empty");
  }
}

// Determine chat trigger type following Go logic
function determineChatTriggerType(req: AnthropicRequest): string {
  if (req.tools && req.tools.length > 0) {
    if (req.tool_choice && typeof req.tool_choice === "object") {
      const tc: any = req.tool_choice;
      if (tc.type === "any" || tc.type === "tool") return "AUTO";
    }
  }
  return "MANUAL";
}

// Convert Anthropic request to CodeWhisperer format
export function anthropicToCodeWhisperer(
  req: AnthropicRequest,
  conversationId: string,
  agentContinuationId?: string,
): CodeWhispererRequest {
  // Get the model ID
  const modelId = MODEL_MAP[req.model];
  if (!modelId) {
    throw new Error(`Model mapping not found for: ${req.model}`);
  }

  // Extract the last message content
  const lastMessage = req.messages[req.messages.length - 1];
  let content = "";

  if (typeof lastMessage.content === "string") {
    content = lastMessage.content;
  } else if (Array.isArray(lastMessage.content)) {
    const textBlock = lastMessage.content.find((b) => b.type === "text");
    content = textBlock?.text || "";
  }

  if (!content && req.tools && req.tools.length > 0) {
    content = "执行工具任务";
  }

  const images = extractImages(lastMessage.content);

  // Build history from previous messages (matching Go implementation)
  const history: unknown[] = [];

  // Add system messages to history if present
  if (req.system && req.system.length > 0) {
    const systemContentParts: string[] = [];
    for (const sysMsg of req.system) {
      if (typeof sysMsg === "string") {
        systemContentParts.push(sysMsg);
      } else if (typeof sysMsg === "object" && sysMsg.type === "text" && sysMsg.text) {
        systemContentParts.push(sysMsg.text);
      }
    }

    if (systemContentParts.length > 0) {
      history.push({
        userInputMessage: {
          content: systemContentParts.join("\n").trim(),
          modelId,
          origin: DEFAULTS.ORIGIN,
          images: [],
          userInputMessageContext: {},
        },
      });

      history.push({
        assistantResponseMessage: {
          content: "OK",
          toolUses: null,
        },
      });
    }
  }

  // Buffer for collecting consecutive user messages
  let userMessagesBuffer: typeof req.messages = [];

  for (let i = 0; i < req.messages.length - 1; i++) {
    const msg = req.messages[i];

    if (msg.role === "user") {
      // Collect user messages in buffer
      userMessagesBuffer.push(msg);
      continue;
    }

    if (msg.role === "assistant") {
      // Process accumulated user messages when we encounter an assistant message
      if (userMessagesBuffer.length > 0) {
        // Merge all accumulated user messages
        const contentParts: string[] = [];
        let allImages: any[] = [];
        let allToolResults: any[] = [];

        for (const userMsg of userMessagesBuffer) {
          const messageContent = extractTextContent(userMsg.content);
          const messageImages = extractImages(userMsg.content);

          if (messageContent) {
            contentParts.push(messageContent);
          }
          if (messageImages.length > 0) {
            allImages = allImages.concat(messageImages);
          }

          // Collect tool results
          const toolResults = extractToolResults(userMsg.content);
          if (toolResults.length > 0) {
            allToolResults = allToolResults.concat(toolResults);
          }
        }

        // Build merged user message
        const userInputMessageContext: any = {};
        if (allToolResults.length > 0) {
          userInputMessageContext.toolResults = allToolResults;
        }

        history.push({
          userInputMessage: {
            content: allToolResults.length > 0 ? "" : contentParts.join("\n"),
            modelId,
            origin: DEFAULTS.ORIGIN,
            images: allImages,
            userInputMessageContext,
          },
        });

        // Clear buffer
        userMessagesBuffer = [];

        // Add assistant message
        const textContent = extractTextContent(msg.content);
        const toolUses = extractToolUses(msg.content);

        const validToolUses = toolUses;

        history.push({
          assistantResponseMessage: {
            content: textContent || "",
            toolUses: validToolUses.length > 0 ? validToolUses : null,
          },
        });
      } else {
        // Orphaned assistant message - warn and skip
        logger.warn("孤立的助手消息，跳过", logger.Int("index", i));
      }
    }
  }

  // Handle orphaned user messages at the end
  if (userMessagesBuffer.length > 0) {
    logger.warn(
      "历史末尾的孤立用户消息，自动配对响应",
      logger.Int("message_count", userMessagesBuffer.length),
    );

    const contentParts: string[] = [];
    let allImages: any[] = [];
    let allToolResults: any[] = [];

    for (const userMsg of userMessagesBuffer) {
      const messageContent = extractTextContent(userMsg.content);
      const messageImages = extractImages(userMsg.content);

      if (messageContent) {
        contentParts.push(messageContent);
      }
      if (messageImages.length > 0) {
        allImages = allImages.concat(messageImages);
      }

      const toolResults = extractToolResults(userMsg.content);
      if (toolResults.length > 0) {
        allToolResults = allToolResults.concat(toolResults);
      }
    }

    const userInputMessageContext: any = {};
    if (allToolResults.length > 0) {
      userInputMessageContext.toolResults = allToolResults;
    }

    history.push({
      userInputMessage: {
        content: allToolResults.length > 0 ? "" : contentParts.join("\n"),
        modelId,
        origin: DEFAULTS.ORIGIN,
        images: allImages,
        userInputMessageContext,
      },
    });

    // Auto-pair with OK response
    history.push({
      assistantResponseMessage: {
        content: "OK",
        toolUses: null,
      },
    });
  }

  const userInputMessageContext: any = {};
  if (req.tools && req.tools.length > 0) {
    userInputMessageContext.tools = convertToolsToCodeWhisperer(req.tools);
  }

  // Add tool results from current message if present
  const currentToolResults = extractToolResults(lastMessage.content);
  if (currentToolResults.length > 0) {
    userInputMessageContext.toolResults = currentToolResults;
    // When tool results are present, content should be empty
    content = "";
  }

  const cwReq: CodeWhispererRequest = {
    conversationState: {
      agentContinuationId: agentContinuationId || crypto.randomUUID(),
      agentTaskType: DEFAULTS.AGENT_TASK_TYPE,
      chatTriggerType: determineChatTriggerType(req),
      currentMessage: {
        userInputMessage: {
          userInputMessageContext,
          content,
          modelId,
          images,
          origin: DEFAULTS.ORIGIN,
        },
      },
      conversationId,
      history,
    },
  };

  // Validate request before sending
  validateCodeWhispererRequest(cwReq);

  return cwReq;
}

// Convert OpenAI request to Anthropic format
export function openAIToAnthropic(req: OpenAIRequest): AnthropicRequest {
  // Convert and filter tools
  const tools = req.tools ? validateAndProcessTools(req.tools) : undefined;

  // Convert tool_choice
  const toolChoice = req.tool_choice
    ? convertOpenAIToolChoiceToAnthropic(req.tool_choice)
    : undefined;

  // Convert messages with content block transformation
  const messages = req.messages.map((msg) => {
    let content = msg.content;

    // Convert content blocks if needed
    if (Array.isArray(content)) {
      content = convertOpenAIContentToAnthropic(content);
    }

    return {
      role: msg.role,
      content: content as string | ContentBlock[],
    };
  });

  // Extract system messages from messages array (OpenAI format)
  const systemMessages: any[] = [];
  const nonSystemMessages = messages.filter((msg) => {
    if (msg.role === "system") {
      if (typeof msg.content === "string") {
        systemMessages.push({ type: "text", text: msg.content });
      }
      return false;
    }
    return true;
  });

  return {
    model: req.model,
    max_tokens: req.max_tokens || DEFAULTS.MAX_TOKENS,
    messages: nonSystemMessages,
    stream: req.stream ?? false,
    temperature: req.temperature,
    system: systemMessages.length > 0 ? systemMessages : undefined,
    tools,
    tool_choice: toolChoice,
  };
}

// Extract text content from message
function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter(b => b.type === "text").map(b => b.text).join("");
  }
  return "";
}

// Extract images from content
function extractImages(content: unknown) {
  if (!Array.isArray(content)) return [];
  
  return content
    .filter(b => b.type === "image" && b.source)
    .map(b => ({
      format: b.source.media_type?.split("/")[1] || "png",
      source: { bytes: b.source.data }
    }));
}

// Extract tool results from content
function extractToolResults(content: unknown) {
  if (!Array.isArray(content)) return [];

  return content
    .filter(b => b.type === "tool_result" && b.tool_use_id)
    .map(b => {
      let contentArray: any[] = [];

      if (b.content !== undefined && b.content !== null) {
        if (typeof b.content === "string") {
          contentArray = [{ text: b.content }];
        } else if (Array.isArray(b.content)) {
          contentArray = b.content.map(item => 
            typeof item === "string" ? { text: item } : item
          ).filter(item => item);
        } else if (typeof b.content === "object") {
          contentArray = [b.content];
        } else {
          contentArray = [{ text: String(b.content) }];
        }
      }

      if (contentArray.length === 0) contentArray = [{ text: "" }];

      return {
        toolUseId: b.tool_use_id,
        content: contentArray,
        status: b.is_error ? "error" : "success",
        isError: b.is_error || false,
      };
    });
}

// Extract tool uses from content
function extractToolUses(content: unknown) {
  if (typeof content === "string" || !Array.isArray(content)) return [];

  return content
    .filter(b => 
      b.type === "tool_use" && 
      b.id && 
      b.name && 
      b.name !== "web_search" && 
      b.name !== "websearch"
    )
    .map(b => ({
      toolUseId: b.id,
      name: b.name,
      input: (b.input && typeof b.input === "object" && !Array.isArray(b.input)) ? b.input : {},
    }));
}

// Convert Anthropic tools to CodeWhisperer format
function convertToolsToCodeWhisperer(tools: unknown[]) {
  return (tools as any[])
    .filter(t => t.name !== "web_search" && t.name !== "websearch")
    .map(t => ({
      toolSpecification: {
        name: t.name,
        description: t.description || "",
        inputSchema: { json: t.input_schema },
      },
    }));
}



// Convert OpenAI content blocks to Anthropic format
function convertOpenAIContentToAnthropic(content: any[]): any[] {
  return content.map(block => {
    if (!block.type) return block;

    if (block.type === "image_url" && block.image_url?.url) {
      const url = block.image_url.url;
      if (url.startsWith("data:")) {
        const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          return {
            type: "image",
            source: { type: "base64", media_type: `image/${match[1]}`, data: match[2] },
          };
        }
      }
      logger.warn("跳过非base64图片URL", logger.String("url", url.substring(0, 50)));
      return null;
    }

    if (block.type === "tool_use" && (block.name === "web_search" || block.name === "websearch")) {
      return null;
    }

    return block;
  }).filter(b => b !== null);
}

// Parse content block from raw object
export function parseContentBlock(block: Record<string, any>): any {
  const blockType = block.type;
  if (!blockType || typeof blockType !== "string") {
    throw new Error("Content block missing type field");
  }

  const contentBlock: any = { type: blockType };

  switch (blockType) {
    case "text":
      if (typeof block.text === "string") {
        contentBlock.text = block.text;
      } else {
        logger.warn("Text block missing text field or not a string");
      }
      break;

    case "image":
      if (block.source && typeof block.source === "object") {
        contentBlock.source = {
          type: block.source.type || "base64",
          media_type: block.source.media_type,
          data: block.source.data,
        };
      }
      break;

    case "image_url":
      // Convert OpenAI image_url to Anthropic format
      if (block.image_url && typeof block.image_url === "object") {
        const url = block.image_url.url;
        if (url && url.startsWith("data:")) {
          const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
          if (match) {
            contentBlock.type = "image";
            contentBlock.source = {
              type: "base64",
              media_type: `image/${match[1]}`,
              data: match[2],
            };
          }
        }
      }
      break;

    case "tool_result":
      contentBlock.tool_use_id = block.tool_use_id;
      contentBlock.content = block.content;
      contentBlock.is_error = block.is_error || false;
      break;

    case "tool_use":
      contentBlock.id = block.id;
      contentBlock.name = block.name;
      contentBlock.input = block.input || {};
      break;
  }

  return contentBlock;
}

// Generate unique IDs
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
