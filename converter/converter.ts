import type { AnthropicRequest } from "../types/anthropic.ts";
import type { OpenAIRequest } from "../types/openai.ts";
import type { CodeWhispererRequest } from "../types/codewhisperer.ts";
import type { ContentBlock } from "../types/common.ts";
import { MODEL_MAP, DEFAULTS } from "../config/constants.ts";

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
    // Handle content blocks
    const textBlock = lastMessage.content.find((b) => b.type === "text");
    content = textBlock?.text || "";
  }

  // Convert images if present
  const images = extractImages(lastMessage.content);

  // Build history from previous messages
  const history: unknown[] = [];
  for (let i = 0; i < req.messages.length - 1; i++) {
    const msg = req.messages[i];
    if (msg.role === "user") {
      history.push({
        userInputMessage: {
          content: extractTextContent(msg.content),
          modelId,
          origin: DEFAULTS.ORIGIN,
          images: extractImages(msg.content),
          userInputMessageContext: {},
        },
      });
    } else if (msg.role === "assistant") {
      history.push({
        assistantResponseMessage: {
          content: extractTextContent(msg.content),
          toolUses: [],
        },
      });
    }
  }

  return {
    conversationState: {
      agentContinuationId: crypto.randomUUID(),
      agentTaskType: DEFAULTS.AGENT_TASK_TYPE,
      chatTriggerType: DEFAULTS.CHAT_TRIGGER_TYPE,
      currentMessage: {
        userInputMessage: {
          userInputMessageContext: {
            tools: req.tools ? convertToolsToCodeWhisperer(req.tools) : [],
          },
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
}

// Convert OpenAI request to Anthropic format
export function openAIToAnthropic(req: OpenAIRequest): AnthropicRequest {
  return {
    model: req.model,
    max_tokens: req.max_tokens || DEFAULTS.MAX_TOKENS,
    messages: req.messages.map((msg) => ({
      role: msg.role,
      content: msg.content as string | ContentBlock[],
    })),
    stream: req.stream || false,
    temperature: req.temperature,
    tools: req.tools ? convertToolsFromOpenAI(req.tools) : undefined,
    tool_choice: req.tool_choice,
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

// Convert Anthropic tools to CodeWhisperer format
function convertToolsToCodeWhisperer(tools: unknown[]) {
  return tools.map((tool: any) => ({
    toolSpecification: {
      name: tool.name,
      description: tool.description,
      inputSchema: {
        json: tool.input_schema,
      },
    },
  }));
}

// Convert OpenAI tools to Anthropic format
function convertToolsFromOpenAI(tools: any[]) {
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  }));
}

// Generate unique IDs
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
