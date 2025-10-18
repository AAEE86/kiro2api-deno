/**
 * Anthropic 到 CodeWhisperer 格式转换器
 */

import type {
  AnthropicMessage,
  AnthropicRequest,
  CodeWhispererMessage,
  CodeWhispererRequest,
  ContentBlock,
} from "../types.ts";
import { getInternalModelId } from "../config.ts";

/**
 * 转换 Anthropic 请求到 CodeWhisperer 格式
 */
export function convertAnthropicToCodeWhisperer(
  req: AnthropicRequest,
  conversationId?: string,
): CodeWhispererRequest {
  // 转换消息历史
  const history: CodeWhispererMessage[] = [];
  let currentMessage = "";

  for (const msg of req.messages) {
    const content = extractTextContent(msg.content);

    if (msg.role === "user") {
      if (currentMessage) {
        // 如果有未处理的用户消息，添加到历史
        history.push({
          userInputMessage: { content: currentMessage },
        });
        currentMessage = "";
      }
      currentMessage = content;
    } else if (msg.role === "assistant") {
      history.push({
        assistantResponseMessage: { content },
      });
    }
  }

  // 构建请求
  const cwRequest: CodeWhispererRequest = {
    conversationState: {
      conversationId,
      history: history.length > 0 ? history : undefined,
      currentMessage: {
        userInputMessage: {
          content: currentMessage || "Hello",
        },
        userIntent: "SUGGEST_ALTERNATE_IMPLEMENTATION",
      },
      chatTriggerType: "MANUAL",
    },
  };

  return cwRequest;
}

/**
 * 提取文本内容
 */
function extractTextContent(
  content: string | ContentBlock[],
): string {
  if (typeof content === "string") {
    return content;
  }

  const textBlocks = content.filter((block) => block.type === "text");
  return textBlocks.map((block) => (block as { text: string }).text).join("\n");
}

/**
 * 转换模型名称
 */
export function convertModelName(publicName: string): string {
  return getInternalModelId(publicName);
}
