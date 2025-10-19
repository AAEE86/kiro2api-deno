import type { AnthropicRequest } from "../types/anthropic.ts";
import type { OpenAIRequest } from "../types/openai.ts";
import type { TokenInfo } from "../types/common.ts";
import { AuthService } from "../auth/auth_service.ts";
import { anthropicToCodeWhisperer, generateId, openAIToAnthropic } from "../converter/converter.ts";
import { AWS_ENDPOINTS, MODEL_MAP } from "../config/constants.ts";
import { CompliantEventStreamParser } from "../parser/compliant_event_stream_parser.ts";
import { ToolLifecycleManager } from "../parser/tool_lifecycle_manager.ts";
import * as logger from "../logger/logger.ts";
// Handle /v1/models endpoint
export async function handleModels(): Promise<Response> {
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
  try {
    const anthropicReq: AnthropicRequest = await req.json();

    // Validate request
    if (!anthropicReq.messages || anthropicReq.messages.length === 0) {
      return Response.json({ error: "messages array cannot be empty" }, { status: 400 });
    }

    // Get token
    const tokenInfo = await authService.getToken();

    if (anthropicReq.stream) {
      return await handleStreamRequest(anthropicReq, tokenInfo);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenInfo);
    }
  } catch (error) {
    logger.error("处理 messages 请求失败", logger.Err(error));
    return Response.json(
      { error: (error as Error).message || "Internal server error" },
      { status: 500 },
    );
  }
}

// Handle /v1/chat/completions endpoint (OpenAI format)
export async function handleChatCompletions(
  req: Request,
  authService: AuthService,
): Promise<Response> {
  try {
    const openaiReq: OpenAIRequest = await req.json();

    // Convert to Anthropic format
    const anthropicReq = openAIToAnthropic(openaiReq);

    // Get token
    const tokenInfo = await authService.getToken();

    if (anthropicReq.stream) {
      return await handleStreamRequest(anthropicReq, tokenInfo);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenInfo);
    }
  } catch (error) {
    logger.error("处理 chat completions 请求失败", logger.Err(error));
    return Response.json(
      { error: (error as Error).message || "Internal server error" },
      { status: 500 },
    );
  }
}

// Handle streaming requests
async function handleStreamRequest(
  anthropicReq: AnthropicRequest,
  tokenInfo: TokenInfo,
): Promise<Response> {
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  const stream = new ReadableStream({
    async start(controller) {
      try {
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

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const toolManager = new ToolLifecycleManager();
        const parser = new CompliantEventStreamParser();

        // Send initial events
        const startEvent = {
          type: "message_start",
          message: {
            id: generateId("msg"),
            type: "message",
            role: "assistant",
            model: anthropicReq.model,
          },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`));

        const blockStartEvent = {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(blockStartEvent)}\n\n`));

        let toolUseDetected = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const { events, toolCalls } = parser.parseStream(chunk);

          if (toolCalls.length > 0) {
            toolUseDetected = true;
            const toolEvents = toolManager.handleToolCallRequest({ toolCalls });
            for (const event of toolEvents) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`));
            }
          }

          for (const event of events) {
            if (event.event === "content_block_delta") {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`));
            } else if (event.event === "content_block_stop") {
              toolManager.handleToolCallResult({
                toolCallId: (event.data as any).tool_call_id,
                result: {},
              });
              const toolEvents = toolManager.handleToolCallResult({
                toolCallId: (event.data as any).tool_call_id,
                result: {},
              });
              for (const event of toolEvents) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(event.data)}\n\n`));
              }
            }
          }
        }

        // Send final events
        const blockStopEvent = { type: "content_block_stop", index: 0 };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(blockStopEvent)}\n\n`));

        const stopReason = toolUseDetected ? "tool_use" : "end_turn";
        const stopEvent = {
          type: "message_delta",
          delta: { stop_reason: stopReason },
          usage: { output_tokens: 0 }, // Placeholder
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopEvent)}\n\n`));

        const messageStopEvent = { type: "message_stop" };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(messageStopEvent)}\n\n`));

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
}

// Handle non-streaming requests
async function handleNonStreamRequest(
  anthropicReq: AnthropicRequest,
  tokenInfo: TokenInfo,
): Promise<Response> {
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  const reqStr = JSON.stringify(cwReq, null, 2);
  logger.debug("发送请求到 CodeWhisperer", logger.Int("request_size", reqStr.length));

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
    const historyWithTools = history.filter((h: any) =>
      h.assistantResponseMessage?.toolUses?.length > 0
    );
    if (historyWithTools.length > 0) {
      logger.debug("历史包含工具使用", logger.Int("tool_use_messages", historyWithTools.length));
    }
  }

  const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenInfo.accessToken}`,
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

  // Parse AWS EventStream binary format
  let content = "";
  const toolUsesMap = new Map<string, any>();
  const toolInputBuffers = new Map<string, string>(); // Buffer for accumulating input strings
  let offset = 0;

  while (offset < data.length) {
    if (offset + 16 > data.length) break;

    // Read message length (4 bytes, big-endian)
    const totalLength = new DataView(data.buffer, offset, 4).getUint32(0, false);
    const headerLength = new DataView(data.buffer, offset + 4, 4).getUint32(0, false);

    if (offset + totalLength > data.length) break;

    // Extract payload
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
        const toolName = event.name;

        // Filter web_search
        if (toolName === "web_search" || toolName === "websearch") {
          offset += totalLength;
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
          toolInputBuffers.set(toolId, ""); // Initialize buffer
        }

        // Accumulate input - CodeWhisperer sends JSON in fragments
        if (event.input !== undefined && event.input !== null) {
          const tool = toolUsesMap.get(toolId)!;

          if (typeof event.input === "object" && !Array.isArray(event.input)) {
            // Complete object received - use it directly
            tool.input = event.input;
          } else if (typeof event.input === "string") {
            // String fragment - accumulate in buffer
            const currentBuffer = toolInputBuffers.get(toolId) || "";
            toolInputBuffers.set(toolId, currentBuffer + event.input);
          }
        }
      }

      // When tool stops, try to parse accumulated input
      if (event.stop && event.toolUseId) {
        const toolId = event.toolUseId;
        const tool = toolUsesMap.get(toolId);
        const inputBuffer = toolInputBuffers.get(toolId);

        if (tool && inputBuffer && inputBuffer.trim()) {
          try {
            tool.input = JSON.parse(inputBuffer);
          } catch (e) {
            logger.warn(
              "解析工具输入失败",
              logger.String("tool_id", toolId),
              logger.String("input", inputBuffer.substring(0, 200)),
              logger.Err(e),
            );
            // Keep empty input if parse fails
          }
        }
      }
    } catch {
      // Skip invalid payload
    }

    offset += totalLength;
  }

  // Final pass: try to parse any remaining buffered inputs
  for (const [toolId, buffer] of toolInputBuffers.entries()) {
    if (buffer && buffer.trim()) {
      const tool = toolUsesMap.get(toolId);
      if (tool && Object.keys(tool.input).length === 0) {
        try {
          tool.input = JSON.parse(buffer);
        } catch (e) {
          logger.warn(
            "解析缓冲输入失败",
            logger.String("tool_id", toolId),
            logger.String("buffer", buffer.substring(0, 200)),
            logger.Err(e),
          );
        }
      }
    }
  }

  const toolUses = Array.from(toolUsesMap.values());

  logger.debug("提取内容", logger.Int("content_length", content.length));
  logger.debug("提取工具使用", logger.Int("tool_use_count", toolUses.length));
  if (toolUses.length > 0) {
    logger.debug("工具使用详情", logger.Any("tool_uses", toolUses));
  }

  // Build content blocks
  const contentBlocks: any[] = [];
  if (content) {
    contentBlocks.push({ type: "text", text: content });
  }
  contentBlocks.push(...toolUses);

  // Convert response to Anthropic format
  const anthropicResponse = {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    model: anthropicReq.model,
    content: contentBlocks,
    stop_reason: toolUses.length > 0 ? "tool_use" : "end_turn",
    usage: {
      input_tokens: 0,
      output_tokens: Math.max(1, Math.ceil(content.length / 4)),
    },
  };

  return Response.json(anthropicResponse);
}
