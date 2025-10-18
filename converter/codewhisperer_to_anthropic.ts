/**
 * CodeWhisperer 到 Anthropic 格式转换器
 */

import type {
  AnthropicResponse,
  AnthropicStreamEvent,
  CodeWhispererStreamEvent,
} from "../types.ts";

/**
 * 转换 CodeWhisperer 流事件到 Anthropic 格式
 */
export function convertCodeWhispererEventToAnthropic(
  event: CodeWhispererStreamEvent,
  messageId: string,
  model: string,
): AnthropicStreamEvent | null {
  // 消息元数据事件
  if (event.messageMetadataEvent) {
    return {
      type: "message_start",
      message: {
        id: messageId,
        type: "message",
        role: "assistant",
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
      },
    };
  }

  // 助手响应事件
  if (event.assistantResponseEvent) {
    return {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "text_delta",
        text: event.assistantResponseEvent.content,
      },
    };
  }

  // 错误事件
  if (event.error) {
    return {
      type: "error",
      delta: {
        type: "error",
        text: event.error.message,
      },
    };
  }

  // 其他事件暂时忽略
  return null;
}

/**
 * 创建消息结束事件
 */
export function createMessageDeltaEvent(
  stopReason: string = "end_turn",
): AnthropicStreamEvent {
  return {
    type: "message_delta",
    delta: {
      type: "message_delta",
      stop_reason: stopReason,
    },
    usage: {
      output_tokens: 0,
    },
  };
}

/**
 * 创建消息停止事件
 */
export function createMessageStopEvent(): AnthropicStreamEvent {
  return {
    type: "message_stop",
  };
}

/**
 * 转换 CodeWhisperer 响应到 Anthropic 格式（非流式）
 */
export function convertCodeWhispererResponseToAnthropic(
  content: string,
  messageId: string,
  model: string,
): AnthropicResponse {
  return {
    id: messageId,
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
    },
  };
}
