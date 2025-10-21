import type { AnthropicRequest } from "../types/anthropic.ts";
import type { TokenInfo } from "../types/common.ts";
import { AuthService } from "../auth/auth_service.ts";
import { anthropicToCodeWhisperer, generateId } from "../converter/converter.ts";
import { MODEL_MAP } from "../config/constants.ts";
import { handleStreamRequest } from "./stream_processor.ts";
import { respondError } from "./common.ts";
import * as logger from "../logger/logger.ts";
import type { TokenWithUsage } from "../types/common.ts";
import { RobustEventStreamParser } from "../parser/robust_parser.ts";
import { calculateInputTokens, calculateOutputTokens } from "../utils/token_calculation.ts";
import { parseEventStreamResponse } from "../utils/response_parser.ts";
import { sendCodeWhispererRequest } from "../utils/codewhisperer_client.ts";
import { createCodeWhispererHeaders } from "../utils/request_headers.ts";

// Handle /v1/models endpoint
export function handleModels(): Response {
  const models = Object.keys(MODEL_MAP).map((id) => ({
    id,
    object: "model",
    created: 1234567890,
    owned_by: "anthropic",
    display_name: id,
    type: "text",
    max_tokens: 200000,
  }));

  return Response.json({
    object: "list",
    data: models,
  });
}

// Handle /api/tokens endpoint
export async function handleTokenStatus(authService: AuthService): Promise<Response> {
  const status = await authService.getTokenPoolStatus();
  return Response.json(status);
}

// Handle /v1/messages endpoint (Anthropic format)
export async function handleMessages(
  req: Request,
  authService: AuthService,
): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    const anthropicReq: AnthropicRequest = await req.json();

    // Validate request
    if (!anthropicReq.messages || anthropicReq.messages.length === 0) {
      return respondError("messages array cannot be empty", 400);
    }

    // Get token with usage
    const tokenWithUsage = await authService.getTokenWithUsage();

    if (anthropicReq.stream) {
      // Use StreamProcessor for streaming requests
      return await handleStreamingRequest(anthropicReq, tokenWithUsage, requestId);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenWithUsage.tokenInfo, requestId);
    }
  } catch (error) {
    logger.error(
      "处理 messages 请求失败",
      logger.String("request_id", requestId),
      logger.Err(error),
    );
    return respondError("Internal server error", 500);
  }
}


// Handle streaming requests using StreamProcessor
async function handleStreamingRequest(
  anthropicReq: AnthropicRequest,
  tokenWithUsage: TokenWithUsage,
  requestId: string,
): Promise<Response> {
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  logger.debug(
    "发送流式请求到 CodeWhisperer",
    logger.String("request_id", requestId),
    logger.String("direction", "upstream_request"),
    logger.String("model", anthropicReq.model),
  );

  const upstreamResponse = await fetch("https://codewhisperer.us-east-1.amazonaws.com/", {
    method: "POST",
    headers: createCodeWhispererHeaders(tokenWithUsage.tokenInfo.accessToken),
    body: JSON.stringify(cwReq),
  });

  // Use StreamProcessor to handle the streaming response
  return await handleStreamRequest(
    anthropicReq,
    tokenWithUsage,
    requestId,
    upstreamResponse,
  );
}

// Handle non-streaming requests with TokenEstimator
async function handleNonStreamRequest(
  anthropicReq: AnthropicRequest,
  tokenInfo: TokenInfo,
  requestId: string,
): Promise<Response> {
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  // Calculate input tokens
  const inputTokens = calculateInputTokens(anthropicReq);

  logger.debug(
    "发送请求到 CodeWhisperer",
    logger.String("request_id", requestId),
    logger.Int("input_tokens", inputTokens),
  );

  const response = await sendCodeWhispererRequest(cwReq, tokenInfo.accessToken, requestId);

  // Read and parse response
  const responseBuffer = await response.arrayBuffer();
  const data = new Uint8Array(responseBuffer);
  logger.debug("CodeWhisperer 响应大小", logger.Int("size", data.length));

  const parser = new RobustEventStreamParser();
  const messages = parser.parseStream(data);
  
  logger.debug(
    "解析消息",
    logger.String("request_id", requestId),
    logger.Int("message_count", messages.length),
  );

  // Parse content and tool uses
  const { content, toolUses } = parseEventStreamResponse(messages, requestId);

  logger.debug(
    "提取内容",
    logger.String("request_id", requestId),
    logger.Int("content_length", content.length),
  );
  logger.debug(
    "提取工具使用",
    logger.String("request_id", requestId),
    logger.Int("tool_use_count", toolUses.length),
  );
  if (toolUses.length > 0) {
    logger.debug(
      "工具使用详情",
      logger.String("request_id", requestId),
      logger.Any("tool_uses", toolUses),
    );
  }

  // Build content blocks
  const contentBlocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }> = [];
  if (content) {
    contentBlocks.push({ type: "text", text: content });
  }
  contentBlocks.push(...toolUses);

  // Calculate output tokens
  const outputTokens = calculateOutputTokens(contentBlocks);

  logger.debug(
    "Token统计",
    logger.String("request_id", requestId),
    logger.Int("input_tokens", inputTokens),
    logger.Int("output_tokens", outputTokens),
  );

  // Convert response to Anthropic format
  const anthropicResponse = {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    model: anthropicReq.model,
    content: contentBlocks,
    stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    },
  };

  return Response.json(anthropicResponse);
}
