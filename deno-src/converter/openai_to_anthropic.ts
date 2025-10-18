/**
 * OpenAI 到 Anthropic 格式转换器
 */

import type {
  AnthropicMessage,
  AnthropicRequest,
  ContentBlock,
  OpenAIMessage,
  OpenAIRequest,
  Tool,
  ToolChoice,
} from "../types.ts";

/**
 * 转换 OpenAI 请求到 Anthropic 格式
 */
export function convertOpenAIToAnthropic(
  req: OpenAIRequest,
): AnthropicRequest {
  const messages: AnthropicMessage[] = [];
  let systemMessage: string | undefined;

  // 处理消息
  for (const msg of req.messages) {
    if (msg.role === "system") {
      // 系统消息单独处理
      systemMessage = msg.content || "";
    } else if (msg.role === "user") {
      messages.push({
        role: "user",
        content: msg.content || "",
      });
    } else if (msg.role === "assistant") {
      const content: ContentBlock[] = [];

      // 添加文本内容
      if (msg.content) {
        content.push({
          type: "text",
          text: msg.content,
        });
      }

      // 添加工具调用
      if (msg.tool_calls) {
        for (const toolCall of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          });
        }
      }

      messages.push({
        role: "assistant",
        content,
      });
    } else if (msg.role === "tool") {
      // 工具结果
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: msg.tool_call_id || "",
            content: msg.content || "",
          },
        ],
      });
    }
  }

  // 构建 Anthropic 请求
  const anthropicReq: AnthropicRequest = {
    model: req.model,
    messages,
    max_tokens: req.max_tokens || 4096,
    temperature: req.temperature,
    top_p: req.top_p,
    stream: req.stream,
    system: systemMessage,
  };

  // 转换工具
  if (req.tools) {
    anthropicReq.tools = req.tools.map(convertOpenAIToolToAnthropic);
  }

  // 转换工具选择
  if (req.tool_choice) {
    anthropicReq.tool_choice = convertOpenAIToolChoiceToAnthropic(
      req.tool_choice,
    );
  }

  return anthropicReq;
}

/**
 * 转换 OpenAI 工具到 Anthropic 格式
 */
function convertOpenAIToolToAnthropic(tool: {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}): Tool {
  return {
    name: tool.function.name,
    description: tool.function.description,
    input_schema: tool.function.parameters,
  };
}

/**
 * 转换 OpenAI 工具选择到 Anthropic 格式
 */
function convertOpenAIToolChoiceToAnthropic(
  toolChoice: "none" | "auto" | { type: "function"; function: { name: string } },
): ToolChoice {
  if (toolChoice === "none") {
    return { type: "auto" };
  }

  if (toolChoice === "auto") {
    return { type: "auto" };
  }

  return {
    type: "tool",
    name: toolChoice.function.name,
  };
}
