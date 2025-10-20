import type { OpenAIRequest } from "../types/openai.ts";
import type { TokenInfo } from "../types/common.ts";
import { openAIToAnthropic } from "../converter/converter.ts";
import { anthropicToCodeWhisperer, generateId } from "../converter/converter.ts";
import { AWS_ENDPOINTS } from "../config/constants.ts";
import { CompliantEventStreamParser } from "../parser/compliant_event_stream_parser.ts";
import * as logger from "../logger/logger.ts";

// 处理OpenAI非流式请求
export async function handleOpenAINonStreamRequest(
  openaiReq: OpenAIRequest,
  tokenInfo: TokenInfo,
): Promise<Response> {
  try {
    // 转换为Anthropic格式
    const anthropicReq = openAIToAnthropic(openaiReq);
    const conversationId = crypto.randomUUID();
    const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

    const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenInfo.accessToken}`,
      },
      body: JSON.stringify(cwReq),
    });

    if (!response.ok) {
      throw new Error(`CodeWhisperer API error: ${response.status}`);
    }

    // 读取响应
    const responseBuffer = await response.arrayBuffer();
    const data = new Uint8Array(responseBuffer);

    // 解析响应
    const parser = new CompliantEventStreamParser();
    let content = "";
    const toolUsesMap = new Map<string, any>();
    let offset = 0;

    while (offset < data.length) {
      if (offset + 16 > data.length) break;

      const totalLength = new DataView(data.buffer, offset, 4).getUint32(0, false);
      const headerLength = new DataView(data.buffer, offset + 4, 4).getUint32(0, false);

      if (offset + totalLength > data.length) break;

      const payloadStart = offset + 12 + headerLength;
      const payloadEnd = offset + totalLength - 4;
      const payloadData = data.slice(payloadStart, payloadEnd);

      try {
        const payload = JSON.parse(new TextDecoder().decode(payloadData));
        const event = payload.assistantResponseEvent || payload;

        if (event.content) {
          content += event.content;
        }

        if (event.toolUseId && event.name) {
          const toolId = event.toolUseId;
          if (!toolUsesMap.has(toolId)) {
            toolUsesMap.set(toolId, {
              type: "tool_use",
              id: toolId,
              name: event.name,
              input: {},
            });
          }

          if (event.input !== undefined && event.input !== null) {
            const tool = toolUsesMap.get(toolId)!;
            if (typeof event.input === "object") {
              tool.input = event.input;
            }
          }
        }
      } catch {
        // Skip invalid payload
      }

      offset += totalLength;
    }

    const toolUses = Array.from(toolUsesMap.values());

    // 构建Anthropic响应
    const anthropicResponse = {
      id: generateId("msg"),
      type: "message",
      role: "assistant",
      model: anthropicReq.model,
      content: [
        ...(content ? [{ type: "text", text: content }] : []),
        ...toolUses,
      ],
      stop_reason: toolUses.length > 0 ? "tool_use" : "stop",
      usage: {
        input_tokens: 0,
        output_tokens: Math.max(1, Math.ceil(content.length / 4)),
      },
    };

    // 转换为OpenAI格式
    const openaiResponse = convertAnthropicToOpenAI(anthropicResponse, openaiReq.model);

    return Response.json(openaiResponse);
  } catch (error) {
    logger.error("处理OpenAI非流式请求失败", logger.Err(error));
    return Response.json({
      error: {
        message: (error as Error).message || "Internal server error",
        type: "server_error",
        code: "internal_error",
      },
    }, { status: 500 });
  }
}

// 处理OpenAI流式请求
export async function handleOpenAIStreamRequest(
  openaiReq: OpenAIRequest,
  tokenInfo: TokenInfo,
): Promise<Response> {
  try {
    // 转换为Anthropic格式
    const anthropicReq = openAIToAnthropic(openaiReq);
    const conversationId = crypto.randomUUID();
    const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

    const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${tokenInfo.accessToken}`,
      },
      body: JSON.stringify(cwReq),
    });

    if (!response.ok || !response.body) {
      throw new Error(`CodeWhisperer API error: ${response.status}`);
    }

    const messageId = `chatcmpl-${Date.now()}`;
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const reader = response.body!.getReader();
          const decoder = new TextDecoder();
          const encoder = new TextEncoder();
          const parser = new CompliantEventStreamParser();

          // 发送初始事件
          const initialEvent = {
            id: messageId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: openaiReq.model,
            choices: [{
              index: 0,
              delta: { role: "assistant" },
              finish_reason: null,
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));

          const toolIndexByToolUseId = new Map<string, number>();
          const toolUseIdByBlockIndex = new Map<number, string>();
          let nextToolIndex = 0;
          let sawToolUse = false;

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            const { events } = parser.parseStream(chunk);

            for (const event of events) {
              const dataMap = event.data as Record<string, any>;
              const eventType = dataMap.type;

              if (eventType === "content_block_delta") {
                const delta = dataMap.delta as Record<string, any>;
                
                if (delta.type === "text_delta" && delta.text) {
                  const contentEvent = {
                    id: messageId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: openaiReq.model,
                    choices: [{
                      index: 0,
                      delta: { content: delta.text },
                      finish_reason: null,
                    }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentEvent)}\n\n`));
                } else if (delta.type === "input_json_delta" && delta.partial_json) {
                  const blockIndex = dataMap.index as number;
                  const toolUseId = toolUseIdByBlockIndex.get(blockIndex);
                  if (toolUseId) {
                    const toolIdx = toolIndexByToolUseId.get(toolUseId);
                    if (toolIdx !== undefined) {
                      const toolDelta = {
                        id: messageId,
                        object: "chat.completion.chunk",
                        created: Math.floor(Date.now() / 1000),
                        model: openaiReq.model,
                        choices: [{
                          index: 0,
                          delta: {
                            tool_calls: [{
                              index: toolIdx,
                              function: { arguments: delta.partial_json },
                            }],
                          },
                          finish_reason: null,
                        }],
                      };
                      controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolDelta)}\n\n`));
                    }
                  }
                }
              } else if (eventType === "content_block_start") {
                const contentBlock = dataMap.content_block as Record<string, any>;
                if (contentBlock.type === "tool_use") {
                  const toolUseId = contentBlock.id as string;
                  const toolName = contentBlock.name as string;
                  const blockIndex = dataMap.index as number;

                  if (!toolIndexByToolUseId.has(toolUseId)) {
                    toolIndexByToolUseId.set(toolUseId, nextToolIndex);
                    nextToolIndex++;
                  }
                  toolUseIdByBlockIndex.set(blockIndex, toolUseId);
                  sawToolUse = true;

                  const toolIdx = toolIndexByToolUseId.get(toolUseId)!;
                  const toolStart = {
                    id: messageId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: openaiReq.model,
                    choices: [{
                      index: 0,
                      delta: {
                        tool_calls: [{
                          index: toolIdx,
                          id: toolUseId,
                          type: "function",
                          function: { name: toolName, arguments: "" },
                        }],
                      },
                      finish_reason: null,
                    }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolStart)}\n\n`));
                }
              }
            }
          }

          // 发送结束事件
          const finishReason = sawToolUse ? "tool_calls" : "stop";
          const finalEvent = {
            id: messageId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: openaiReq.model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: finishReason,
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalEvent)}\n\n`));
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    logger.error("处理OpenAI流式请求失败", logger.Err(error));
    return Response.json({
      error: {
        message: (error as Error).message || "Internal server error",
        type: "server_error",
        code: "internal_error",
      },
    }, { status: 500 });
  }
}

// 转换Anthropic响应为OpenAI格式
function convertAnthropicToOpenAI(anthropicResp: any, model: string): any {
  const choices = [];
  let message: any = {
    role: "assistant",
    content: null,
  };

  // 处理内容
  if (anthropicResp.content && Array.isArray(anthropicResp.content)) {
    const textParts: string[] = [];
    const toolCalls: any[] = [];

    for (const item of anthropicResp.content) {
      if (item.type === "text") {
        textParts.push(item.text);
      } else if (item.type === "tool_use") {
        toolCalls.push({
          id: item.id,
          type: "function",
          function: {
            name: item.name,
            arguments: JSON.stringify(item.input),
          },
        });
      }
    }

    if (textParts.length > 0) {
      message.content = textParts.join("");
    }

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
  }

  choices.push({
    index: 0,
    message,
    finish_reason: anthropicResp.stop_reason === "tool_use" ? "tool_calls" : "stop",
  });

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    usage: anthropicResp.usage || {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
  };
}
