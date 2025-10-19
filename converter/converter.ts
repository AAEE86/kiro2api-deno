import type { AnthropicRequest } from "../types/anthropic.ts";
import type { OpenAIRequest } from "../types/openai.ts";
import type { CodeWhispererRequest } from "../types/codewhisperer.ts";
import type { ContentBlock } from "../types/common.ts";
import { DEFAULTS, MODEL_MAP } from "../config/constants.ts";
import * as logger from "../logger/logger.ts";

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
): CodeWhispererRequest {
  // Get the model ID
  const modelId = MODEL_MAP[req.model] || req.model;

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

        // Map tool uses to correct format (don't filter out empty inputs)
        // Go version ensures empty inputs become empty objects, not filtered out
        const validToolUses = toolUses.map((tu: any) => ({
          toolUseId: tu.toolUseId,
          name: tu.name,
          input: tu.input || {}, // Ensure input is at least an empty object
        }));

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
      agentContinuationId: crypto.randomUUID(),
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

  return {
    model: req.model,
    max_tokens: req.max_tokens || DEFAULTS.MAX_TOKENS,
    messages,
    stream: req.stream || false,
    temperature: req.temperature,
    tools,
    tool_choice: toolChoice,
  };
}

// Extract text content from message
function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === "text");
    return textBlock?.text || "";
  }
  return "";
}

// Extract images from content
function extractImages(content: unknown) {
  const images: Array<{ format: string; source: { bytes: string } }> = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "image" && block.source) {
        const format = block.source.media_type?.split("/")[1] || "png";
        images.push({
          format,
          source: {
            bytes: block.source.data,
          },
        });
      }
    }
  }

  return images;
}

// Extract tool results from content
// Match Go implementation in converter/codewhisperer.go:89-203
function extractToolResults(content: unknown) {
  const toolResults: Array<any> = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_result") {
        // Validate required fields
        if (!block.tool_use_id) {
          logger.warn("tool_result 缺少 tool_use_id，跳过");
          continue;
        }

        let contentArray: any[] = [];

        // Process content following Go implementation logic
        if (block.content !== undefined && block.content !== null) {
          if (typeof block.content === "string") {
            // String -> wrap in text object
            contentArray = [{ text: block.content }];
          } else if (Array.isArray(block.content)) {
            // Array -> convert each item
            for (const item of block.content) {
              if (typeof item === "string") {
                contentArray.push({ text: item });
              } else if (typeof item === "object" && item !== null) {
                contentArray.push(item);
              }
            }
          } else if (typeof block.content === "object") {
            // Object -> wrap in array
            contentArray = [block.content];
          } else {
            // Other types -> convert to string and wrap
            contentArray = [{ text: String(block.content) }];
          }
        }

        // Ensure contentArray is not empty (minimum requirement)
        if (contentArray.length === 0) {
          contentArray = [{ text: "" }];
        }

        toolResults.push({
          toolUseId: block.tool_use_id,
          content: contentArray,
          status: block.is_error ? "error" : "success",
          isError: block.is_error || false,
        });
      }
    }
  }

  return toolResults;
}

// Extract tool uses from content
// Match Go implementation in converter/codewhisperer.go:525-607
function extractToolUses(content: unknown) {
  const toolUses: Array<any> = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      if (block.type === "tool_use") {
        // Validate required fields first
        if (!block.id || !block.name) {
          logger.warn("tool_use 缺少 id 或 name，跳过", logger.Any("block", block));
          continue;
        }

        // Filter web_search (silent filter, don't send to upstream)
        if (block.name === "web_search" || block.name === "websearch") {
          continue;
        }

        // Ensure input is always a map, even if missing or null
        // This matches Go logic: toolUse.Input = map[string]any{}
        let input: Record<string, unknown> = {};
        if (block.input && typeof block.input === "object" && !Array.isArray(block.input)) {
          input = block.input;
        }

        toolUses.push({
          toolUseId: block.id,
          name: block.name,
          input: input,
        });
      }
    }
  } else if (typeof content === "string") {
    // Pure text content, no tool uses
    return [];
  }

  return toolUses;
}

// Convert Anthropic tools to CodeWhisperer format
function convertToolsToCodeWhisperer(tools: unknown[]) {
  const validTools: any[] = [];

  for (const tool of tools as any[]) {
    // Filter web_search
    if (tool.name === "web_search" || tool.name === "websearch") continue;

    // Clean input schema
    const cleanedSchema = cleanToolSchema(tool.input_schema);

    validTools.push({
      toolSpecification: {
        name: tool.name,
        description: tool.description || "",
        inputSchema: {
          json: cleanedSchema,
        },
      },
    });
  }

  return validTools;
}

// Clean tool schema by removing unsupported fields
function cleanToolSchema(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const cleaned = { ...schema };

  // Remove unsupported top-level fields
  delete cleaned.additionalProperties;
  delete cleaned.strict;
  delete cleaned.$schema;
  delete cleaned.$id;
  delete cleaned.$ref;
  delete cleaned.definitions;
  delete cleaned.$defs;

  // Ensure type is set
  if (!cleaned.type) {
    cleaned.type = "object";
  }

  // Ensure properties exists for object type
  if (cleaned.type === "object" && !cleaned.properties) {
    cleaned.properties = {};
  }

  // Clean nested properties recursively
  if (cleaned.properties && typeof cleaned.properties === "object") {
    const cleanedProps: any = {};
    for (const [key, value] of Object.entries(cleaned.properties)) {
      // Truncate long parameter names (CodeWhisperer limit)
      let cleanedKey = key;
      if (key.length > 64) {
        cleanedKey = key.length > 80
          ? key.substring(0, 20) + "_" + key.substring(key.length - 20)
          : key.substring(0, 30) + "_param";
      }

      if (typeof value === "object" && value !== null) {
        cleanedProps[cleanedKey] = cleanToolSchema(value);
      } else {
        cleanedProps[cleanedKey] = value;
      }
    }
    cleaned.properties = cleanedProps;
  }

  // Update required array with cleaned parameter names
  if (cleaned.required && Array.isArray(cleaned.required)) {
    cleaned.required = cleaned.required.map((req: any) => {
      if (typeof req === "string" && req.length > 64) {
        return req.length > 80
          ? req.substring(0, 20) + "_" + req.substring(req.length - 20)
          : req.substring(0, 30) + "_param";
      }
      return req;
    }).filter((req: any) => typeof req === "string" && req !== "");
  }

  // Clean items for array type
  if (cleaned.items && typeof cleaned.items === "object") {
    cleaned.items = cleanToolSchema(cleaned.items);
  }

  // Validate object type has properties
  if (
    cleaned.type === "object" &&
    (!cleaned.properties || Object.keys(cleaned.properties).length === 0)
  ) {
    cleaned.properties = {};
  }

  return cleaned;
}

// Validate and process tools (filter unsupported tools like web_search)
function validateAndProcessTools(tools: any[]): any[] {
  const validTools: any[] = [];

  for (const tool of tools) {
    // Only support function type
    if (tool.type !== "function") continue;

    // Filter unsupported tools (web_search)
    const name = tool.function?.name;
    if (!name || name === "web_search" || name === "websearch") continue;

    // Validate parameters
    if (!tool.function.parameters) continue;

    // Clean schema
    const cleanedSchema = cleanToolSchema(tool.function.parameters);

    validTools.push({
      name: tool.function.name,
      description: tool.function.description || "",
      input_schema: cleanedSchema,
    });
  }

  return validTools;
}

// Convert OpenAI tool_choice to Anthropic format
function convertOpenAIToolChoiceToAnthropic(toolChoice: any): any {
  if (!toolChoice) return undefined;

  // String format: "auto", "none", "required"
  if (typeof toolChoice === "string") {
    switch (toolChoice) {
      case "auto":
        return { type: "auto" };
      case "required":
      case "any":
        return { type: "any" };
      case "none":
        return undefined; // Anthropic doesn't have "none"
      default:
        return { type: "auto" };
    }
  }

  // Object format: {type: "function", function: {name: "tool_name"}}
  if (typeof toolChoice === "object") {
    if (toolChoice.type === "function" && toolChoice.function?.name) {
      return {
        type: "tool",
        name: toolChoice.function.name,
      };
    }
  }

  return { type: "auto" };
}

// Convert OpenAI content blocks to Anthropic format
function convertOpenAIContentToAnthropic(content: any[]): any[] {
  const converted: any[] = [];

  for (const block of content) {
    if (!block.type) {
      converted.push(block);
      continue;
    }

    switch (block.type) {
      case "text":
        converted.push(block);
        break;

      case "image_url": {
        // Convert OpenAI image_url to Anthropic image format
        const imageUrl = block.image_url;
        if (imageUrl?.url) {
          const url = imageUrl.url;

          // Handle data URLs
          if (url.startsWith("data:")) {
            const match = url.match(/^data:image\/(\w+);base64,(.+)$/);
            if (match) {
              converted.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: `image/${match[1]}`,
                  data: match[2],
                },
              });
            }
          }
        }
        break;
      }

      case "image":
        converted.push(block);
        break;

      case "tool_use": {
        // Filter web_search
        if (block.name === "web_search" || block.name === "websearch") {
          break;
        }
        converted.push(block);
        break;
      }

      case "tool_result":
        converted.push(block);
        break;

      default:
        converted.push(block);
    }
  }

  return converted;
}

// Generate unique IDs
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
