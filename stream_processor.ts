/**
 * 流式处理器
 * 处理 CodeWhisperer 流式响应并转换为 Anthropic/OpenAI 格式
 */

import type {
  AnthropicRequest,
  AnthropicStreamEvent,
  CodeWhispererRequest,
  CodeWhispererResponse,
} from "./types.ts";
import { AuthService } from "./auth/auth_service.ts";
import { CONSTANTS } from "./config.ts";
import {
  EventStreamParser,
  parseCodeWhispererEvent,
} from "./parser/event_stream_parser.ts";
import {
  convertCodeWhispererEventToAnthropic,
  createMessageDeltaEvent,
  createMessageStopEvent,
} from "./converter/codewhisperer_to_anthropic.ts";
import { convertAnthropicToCodeWhisperer } from "./converter/anthropic_to_codewhisperer.ts";
import * as logger from "./logger.ts";

// ============================================================================
// 流式处理器
// ============================================================================

export class StreamProcessor {
  constructor(private authService: AuthService) {}

  /**
   * 处理流式请求
   */
  async processStream(
    anthropicReq: AnthropicRequest,
    conversationId?: string,
  ): Promise<ReadableStream<Uint8Array>> {
    const messageId = `msg_${crypto.randomUUID()}`;
    const model = anthropicReq.model;

    // 转换请求
    const cwRequest = convertAnthropicToCodeWhisperer(
      anthropicReq,
      conversationId,
    );

    // 获取 Token
    const token = await this.authService.getAccessToken();

    // 发送请求到 CodeWhisperer
    const response = await this.sendCodeWhispererRequest(cwRequest, token);

    if (!response.$responseStream) {
      throw new Error("CodeWhisperer 未返回流式响应");
    }

    // 创建转换流
    return this.createTransformStream(
      response.$responseStream,
      messageId,
      model,
    );
  }

  /**
   * 发送请求到 CodeWhisperer
   */
  private async sendCodeWhispererRequest(
    request: CodeWhispererRequest,
    token: string,
  ): Promise<CodeWhispererResponse> {
    const url = CONSTANTS.CODEWHISPERER_STREAMING_API_URL;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `CodeWhisperer 请求失败: ${response.status} ${response.statusText} - ${errorText}`,
      );
    }

    // 提取 conversationId（如果有）
    const conversationId = response.headers.get("x-amzn-sessionid") ||
      crypto.randomUUID();

    return {
      conversationId,
      $responseStream: response.body || undefined,
    };
  }

  /**
   * 创建转换流
   */
  private createTransformStream(
    sourceStream: ReadableStream<Uint8Array>,
    messageId: string,
    model: string,
  ): ReadableStream<Uint8Array> {
    const parser = new EventStreamParser();
    const encoder = new TextEncoder();
    let hasStarted = false;

    return new ReadableStream({
      async start(controller) {
        const reader = sourceStream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();

            if (done) {
              // 发送结束事件
              if (hasStarted) {
                const deltaEvent = createMessageDeltaEvent();
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`),
                );

                const stopEvent = createMessageStopEvent();
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify(stopEvent)}\n\n`),
                );
              }

              controller.close();
              break;
            }

            // 解析 EventStream 消息
            const messages = parser.parse(value);

            for (const message of messages) {
              const cwEvent = parseCodeWhispererEvent(message);

              if (!cwEvent) {
                continue;
              }

              // 转换为 Anthropic 事件
              const anthropicEvent = convertCodeWhispererEventToAnthropic(
                cwEvent,
                messageId,
                model,
              );

              if (!anthropicEvent) {
                continue;
              }

              // 发送事件
              const eventData = `data: ${JSON.stringify(anthropicEvent)}\n\n`;
              controller.enqueue(encoder.encode(eventData));

              if (anthropicEvent.type === "message_start") {
                hasStarted = true;
              }
            }
          }
        } catch (error) {
          logger.error("流式处理错误", {
            error: error instanceof Error ? error.message : String(error),
          });

          // 发送错误事件
          const errorEvent = {
            type: "error",
            error: {
              type: "api_error",
              message: error instanceof Error
                ? error.message
                : "未知错误",
            },
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`),
          );

          controller.close();
        } finally {
          reader.releaseLock();
        }
      },
    });
  }

  /**
   * 处理非流式请求
   */
  async processNonStream(
    anthropicReq: AnthropicRequest,
    conversationId?: string,
  ): Promise<string> {
    const messageId = `msg_${crypto.randomUUID()}`;
    const model = anthropicReq.model;

    // 转换请求
    const cwRequest = convertAnthropicToCodeWhisperer(
      anthropicReq,
      conversationId,
    );

    // 获取 Token
    const token = await this.authService.getAccessToken();

    // 发送请求到 CodeWhisperer
    const response = await this.sendCodeWhispererRequest(cwRequest, token);

    if (!response.$responseStream) {
      throw new Error("CodeWhisperer 未返回流式响应");
    }

    // 收集所有内容
    const content = await this.collectStreamContent(response.$responseStream);

    // 构建响应
    const anthropicResponse = {
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

    return JSON.stringify(anthropicResponse);
  }

  /**
   * 收集流式内容
   */
  private async collectStreamContent(
    stream: ReadableStream<Uint8Array>,
  ): Promise<string> {
    const parser = new EventStreamParser();
    const reader = stream.getReader();
    let content = "";

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        // 解析 EventStream 消息
        const messages = parser.parse(value);

        for (const message of messages) {
          const cwEvent = parseCodeWhispererEvent(message);

          if (cwEvent?.assistantResponseEvent) {
            content += cwEvent.assistantResponseEvent.content;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return content;
  }
}
