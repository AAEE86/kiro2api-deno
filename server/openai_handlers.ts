import type { OpenAIRequest, OpenAIResponse, OpenAIMessage, OpenAIToolCall } from "../types/openai.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";
import { openAIToAnthropic } from "../converter/converter.ts";
import { anthropicToCodeWhisperer, generateId } from "../converter/converter.ts";
import { AWS_ENDPOINTS } from "../config/constants.ts";
import { TokenEstimator } from "../utils/token_estimator.ts";
import { respondError } from "./common.ts";
import { handleOpenAIStreamRequest as streamProcessor } from "./openai_stream_processor.ts";
import * as logger from "../logger/logger.ts";

// 处理OpenAI非流式请求
export async function handleOpenAINonStreamRequest(
  openaiReq: OpenAIRequest,
  tokenInfo: TokenInfo,
  requestId?: string,
): Promise<Response> {
  const rid = requestId || crypto.randomUUID();

  try {
    // 转换为Anthropic格式
    const anthropicReq = openAIToAnthropic(openaiReq);
    const conversationId = crypto.randomUUID();
    const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

    // Calculate input tokens using TokenEstimator
    const estimator = new TokenEstimator();
    const systemMessages = anthropicReq.system?.map(s => ({ text: typeof s === "string" ? s : s.text }));
    const inputTokens = estimator.estimateTokens({
      system: systemMessages,
      messages: anthropicReq.messages,
      tools: anthropicReq.tools,
    });

    logger.debug(
      "发送OpenAI请求到 CodeWhisperer",
      logger.String("request_id", rid),
      logger.String("direction", "upstream_request"),
      logger.String("model", openaiReq.model),
      logger.Int("input_tokens", inputTokens),
    );

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
    let content = "";
    const toolUsesMap = new Map<string, { type: string; id: string; name: string; input: unknown }>();
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

    // Build content blocks
    const contentBlocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [
      ...(content ? [{ type: "text", text: content }] : []),
      ...toolUses,
    ];

    // Calculate output tokens using TokenEstimator
    let outputTokens = 0;
    for (const contentBlock of contentBlocks) {
      const blockType = contentBlock.type;

      switch (blockType) {
        case "text":
          if (contentBlock.text) {
            outputTokens += estimator.estimateTextTokens(contentBlock.text);
          }
          break;

        case "tool_use":
          if (contentBlock.name) {
            outputTokens += estimator.estimateToolUseTokens(
              contentBlock.name,
              contentBlock.input as Record<string, unknown> || {},
            );
          }
          break;
      }
    }

    // Minimum token protection
    outputTokens = Math.max(1, outputTokens);

    logger.debug(
      "OpenAI非流式响应Token统计",
      logger.String("request_id", rid),
      logger.Int("input_tokens", inputTokens),
      logger.Int("output_tokens", outputTokens),
    );

    // 构建Anthropic响应
    const anthropicResponse = {
      id: generateId("msg"),
      type: "message",
      role: "assistant",
      model: anthropicReq.model,
      content: contentBlocks,
      stop_reason: toolUses.length > 0 ? "tool_use" : "stop",
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      },
    };

    // 转换为OpenAI格式
    const openaiResponse = convertAnthropicToOpenAI(anthropicResponse, openaiReq.model);

    return Response.json(openaiResponse);
  } catch (error) {
    logger.error(
      "处理OpenAI非流式请求失败",
      logger.String("request_id", rid),
      logger.Err(error),
    );
    return respondError("Internal server error", 500);
  }
}

// 处理OpenAI流式请求 - 使用OpenAIStreamProcessor
export async function handleOpenAIStreamRequest(
  openaiReq: OpenAIRequest,
  tokenWithUsage: TokenWithUsage,
  requestId: string,
): Promise<Response> {
  // 直接使用OpenAIStreamProcessor处理
  return await streamProcessor(openaiReq, tokenWithUsage, requestId);
}

/**
 * 转换Anthropic响应为OpenAI格式
 */
function convertAnthropicToOpenAI(anthropicResp: Record<string, unknown>, model: string): OpenAIResponse {
  const choices = [];
  const message: OpenAIMessage = {
    role: "assistant",
    content: null,
  };

  // 处理内容
  if (anthropicResp.content && Array.isArray(anthropicResp.content)) {
    const textParts: string[] = [];
    const toolCalls: OpenAIToolCall[] = [];

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

  // Map Anthropic usage to OpenAI format
  const usageObj = anthropicResp.usage as Record<string, unknown> | undefined;
  const usage = usageObj ? {
    prompt_tokens: (usageObj.input_tokens as number) || 0,
    completion_tokens: (usageObj.output_tokens as number) || 0,
    total_tokens: ((usageObj.input_tokens as number) || 0) + ((usageObj.output_tokens as number) || 0),
  } : {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  };

  return {
    id: `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices,
    usage,
  };
}
