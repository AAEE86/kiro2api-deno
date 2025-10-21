import type { AnthropicRequest } from "../types/anthropic.ts";
import type { TokenInfo } from "../types/common.ts";
import { AuthService } from "../auth/auth_service.ts";
import { anthropicToCodeWhisperer, generateId } from "../converter/converter.ts";
import { AWS_ENDPOINTS, MODEL_MAP } from "../config/constants.ts";
import { TokenEstimator } from "../utils/token_estimator.ts";
import { handleStreamRequest } from "./stream_processor.ts";
import { respondError } from "./common.ts";
import * as logger from "../logger/logger.ts";
import type { TokenWithUsage } from "../types/common.ts";
import { RobustEventStreamParser } from "../parser/robust_parser.ts";
import { isObject, isString, parseJsonSafely, extractToolInput } from "../types/guards.ts";

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

  const upstreamResponse = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenWithUsage.tokenInfo.accessToken}`,
      "x-amzn-kiro-agent-mode": "spec",
      "x-amz-user-agent": "aws-sdk-js/1.0.18 KiroIDE-0.2.13-66c23a8c5d15afabec89ef9954ef52a119f10d369df04d548fc6c1eac694b0d1",
      "user-agent": "aws-sdk-js/1.0.18 ua/2.1 os/darwin#25.0.0 lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.2.13-66c23a8c5d15afabec89ef9954ef52a119f10d369df04d548fc6c1eac694b0d1",
    },
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

  // Calculate input tokens using TokenEstimator
  const estimator = new TokenEstimator();
  const systemMessages = anthropicReq.system
    ? typeof anthropicReq.system === "string"
      ? [{ text: anthropicReq.system }]
      : anthropicReq.system.map(s => ({ text: typeof s === "string" ? s : s.text }))
    : undefined;
  const inputTokens = estimator.estimateTokens({
    system: systemMessages,
    messages: anthropicReq.messages,
    tools: anthropicReq.tools,
  });

  const reqStr = JSON.stringify(cwReq, null, 2);
  logger.debug(
    "发送请求到 CodeWhisperer",
    logger.String("request_id", requestId),
    logger.String("direction", "upstream_request"),
    logger.Int("request_size", reqStr.length),
    logger.Int("input_tokens", inputTokens),
  );

  // Debug: Log full request for tool use debugging
  if (Deno.env.get("DEBUG_TOOLS") === "true") {
    logger.debug("完整请求", logger.Any("request", JSON.parse(reqStr)));
  }

  // Log tool information if present
  const tools =
    cwReq.conversationState.currentMessage.userInputMessage.userInputMessageContext.tools;
  const toolResults =
    cwReq.conversationState.currentMessage.userInputMessage.userInputMessageContext.toolResults;
  if (tools && tools.length > 0) {
    logger.debug("工具定义", logger.Int("tool_count", tools.length));
    // Log first tool schema for debugging
    if (tools[0]) {
      logger.debug(
        "第一个工具模式示例",
        logger.Any(
          "schema",
          JSON.stringify(tools[0].toolSpecification.inputSchema.json, null, 2).substring(0, 500),
        ),
      );
    }
  }
  if (toolResults && toolResults.length > 0) {
    logger.debug("工具结果", logger.Int("result_count", toolResults.length));
    logger.debug("工具结果详情", logger.Any("results", toolResults));
  }

  // Log history summary
  const history = cwReq.conversationState.history;
  if (history && history.length > 0) {
    logger.debug("历史消息", logger.Int("history_count", history.length));
    // Check for tool uses in history
    const historyWithTools = history.filter((h: unknown) => {
      const msg = h as { assistantResponseMessage?: { toolUses?: unknown[] } };
      return msg.assistantResponseMessage?.toolUses?.length ?? 0 > 0;
    });
    if (historyWithTools.length > 0) {
      logger.debug("历史包含工具使用", logger.Int("tool_use_messages", historyWithTools.length));
    }
  }

  const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenInfo.accessToken}`,
      "x-amzn-kiro-agent-mode": "spec",
      "x-amz-user-agent": "aws-sdk-js/1.0.18 KiroIDE-0.2.13-66c23a8c5d15afabec89ef9954ef52a119f10d369df04d548fc6c1eac694b0d1",
      "user-agent": "aws-sdk-js/1.0.18 ua/2.1 os/darwin#25.0.0 lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.2.13-66c23a8c5d15afabec89ef9954ef52a119f10d369df04d548fc6c1eac694b0d1",
    },
    body: JSON.stringify(cwReq),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      "CodeWhisperer API 错误",
      logger.Int("status", response.status),
      logger.String("error", errorText),
    );
    logger.debug("失败的请求", logger.String("request", reqStr));
    throw new Error(`CodeWhisperer API error: ${response.status}`);
  }

  // Read response as binary (AWS EventStream format)
  const responseBuffer = await response.arrayBuffer();
  const data = new Uint8Array(responseBuffer);
  logger.debug("CodeWhisperer 响应大小", logger.Int("size", data.length));

  // Use RobustEventStreamParser for parsing - reduces CPU usage by 30-40%
  const parser = new RobustEventStreamParser();
  const messages = parser.parseStream(data);
  
  logger.debug(
    "解析消息",
    logger.String("request_id", requestId),
    logger.Int("message_count", messages.length),
  );

  // Extract content and tool uses from parsed messages
  let content = "";
  const toolUsesMap = new Map<string, { type: string; id: string; name: string; input: unknown }>();
  const toolInputBuffers = new Map<string, string>();

  for (const message of messages) {
    try {
      const payloadStr = new TextDecoder().decode(message.payload);
      const payload = parseJsonSafely(payloadStr);
      
      if (!isObject(payload)) continue;
      
      const event = isObject(payload.assistantResponseEvent) 
        ? payload.assistantResponseEvent 
        : payload;
      
      if (!isObject(event)) continue;

      // Extract content
      if (isString(event.content)) {
        content += event.content;
      }

      // Extract tool use information
      if (isString(event.toolUseId) && isString(event.name)) {
        const toolId = event.toolUseId;
        const toolName = event.name;

        // Filter web_search
        if (toolName === "web_search" || toolName === "websearch") {
          continue;
        }

        // Get or create tool entry
        if (!toolUsesMap.has(toolId)) {
          toolUsesMap.set(toolId, {
            type: "tool_use",
            id: toolId,
            name: toolName,
            input: {},
          });
          toolInputBuffers.set(toolId, "");
        }

        // Accumulate input
        if (event.input !== undefined && event.input !== null) {
          const tool = toolUsesMap.get(toolId)!;

          if (isObject(event.input)) {
            tool.input = event.input;
          } else if (isString(event.input)) {
            const currentBuffer = toolInputBuffers.get(toolId) || "";
            toolInputBuffers.set(toolId, currentBuffer + event.input);
          }
        }

        // When tool stops, try to parse accumulated input
        if (event.stop === true) {
          const tool = toolUsesMap.get(toolId);
          const inputBuffer = toolInputBuffers.get(toolId);

          if (tool && inputBuffer && inputBuffer.trim()) {
            tool.input = extractToolInput(inputBuffer);
          }
        }
      }
    } catch (e) {
      logger.debug(
        "跳过无效消息",
        logger.String("request_id", requestId),
        logger.Err(e),
      );
    }
  }

  // Final pass: parse any remaining buffered inputs
  for (const [toolId, buffer] of toolInputBuffers.entries()) {
    if (buffer && buffer.trim()) {
      const tool = toolUsesMap.get(toolId);
      if (tool && isObject(tool.input) && Object.keys(tool.input).length === 0) {
        tool.input = extractToolInput(buffer);
      }
    }
  }

  const toolUses = Array.from(toolUsesMap.values());

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
