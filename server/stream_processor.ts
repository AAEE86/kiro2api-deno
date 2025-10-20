import type { AnthropicRequest } from "../types/anthropic.ts";
import type { TokenWithUsage } from "../types/common.ts";
import { TokenEstimator } from "../utils/token_estimator.ts";
import { CompliantEventStreamParser } from "../parser/compliant_event_stream_parser.ts";
import { SSEStateManager } from "./sse_state_manager.ts";
import { StopReasonManager, getStopReasonDescription } from "./stop_reason_manager.ts";
import { ErrorMapper } from "./error_mapper.ts";
import * as logger from "../logger/logger.ts";

/**
 * 流处理器上下文
 * 封装流式请求处理的所有状态
 * 
 * 设计原则：
 * 1. 单一职责：专注于流式数据处理
 * 2. 状态封装：所有处理状态统一管理
 * 3. 生命周期管理：完整的cleanup机制
 */
export class StreamProcessorContext {
  // 请求信息
  public readonly anthropicReq: AnthropicRequest;
  public readonly tokenWithUsage: TokenWithUsage;
  public readonly messageId: string;
  public readonly requestId: string;
  public readonly inputTokens: number;

  // 状态管理器
  private readonly sseStateManager: SSEStateManager;
  private readonly stopReasonManager: StopReasonManager;
  private readonly tokenEstimator: TokenEstimator;
  private readonly compliantParser: CompliantEventStreamParser;

  // 流处理状态
  public totalOutputTokens = 0;
  public totalReadBytes = 0;
  public totalProcessedEvents = 0;

  // 工具调用追踪
  private readonly toolUseIdByBlockIndex = new Map<number, string>();
  private readonly completedToolUseIds = new Set<string>();

  constructor(
    anthropicReq: AnthropicRequest,
    tokenWithUsage: TokenWithUsage,
    messageId: string,
    requestId: string,
    inputTokens: number,
  ) {
    this.anthropicReq = anthropicReq;
    this.tokenWithUsage = tokenWithUsage;
    this.messageId = messageId;
    this.requestId = requestId;
    this.inputTokens = inputTokens;

    // 初始化管理器
    this.sseStateManager = new SSEStateManager(false);
    this.stopReasonManager = new StopReasonManager();
    this.tokenEstimator = new TokenEstimator();
    this.compliantParser = new CompliantEventStreamParser();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    // 清理解析器状态
    this.compliantParser.reset();

    // 清理工具调用映射
    this.toolUseIdByBlockIndex.clear();
    this.completedToolUseIds.clear();
  }

  /**
   * 发送初始事件
   */
  sendInitialEvents(controller: ReadableStreamDefaultController): void {
    const encoder = new TextEncoder();

    // message_start事件
    const startEvent = {
      type: "message_start",
      message: {
        id: this.messageId,
        type: "message",
        role: "assistant",
        model: this.anthropicReq.model,
        content: [],
        stop_reason: null,
        usage: { input_tokens: this.inputTokens, output_tokens: 0 },
      },
    };

    const validation = this.sseStateManager.validateAndSend(startEvent);
    if (validation.valid) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`));
    }

    // ping事件
    const pingEvent = { type: "ping" };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(pingEvent)}\n\n`));
  }

  /**
   * 处理工具使用开始事件
   */
  private processToolUseStart(dataMap: Record<string, unknown>): void {
    const contentBlock = dataMap.content_block as Record<string, unknown>;
    if (!contentBlock || contentBlock.type !== "tool_use") {
      return;
    }

    const index = dataMap.index as number;
    const toolId = contentBlock.id as string;

    if (toolId) {
      this.toolUseIdByBlockIndex.set(index, toolId);
      logger.debug(
        "转发tool_use开始",
        logger.String("request_id", this.requestId),
        logger.String("tool_use_id", toolId),
        logger.String("tool_name", contentBlock.name as string),
        logger.Int("index", index),
      );
    }
  }

  /**
   * 处理工具使用结束事件
   */
  private processToolUseStop(dataMap: Record<string, unknown>): void {
    const index = dataMap.index as number;
    const toolId = this.toolUseIdByBlockIndex.get(index);

    if (toolId) {
      // 关键：先记录到完成集合，再删除映射
      this.completedToolUseIds.add(toolId);
      this.toolUseIdByBlockIndex.delete(index);
    }
  }

  /**
   * 处理单个事件
   */
  processEvent(
    event: { data: unknown },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ): void {
    const dataMap = event.data as Record<string, unknown>;
    if (!dataMap) return;

    const eventType = dataMap.type as string;

    // 处理不同类型的事件
    switch (eventType) {
      case "content_block_start":
        this.processToolUseStart(dataMap);
        break;

      case "content_block_stop":
        this.processToolUseStop(dataMap);
        break;

      case "content_block_delta":
        // Token估算在验证发送后处理
        break;
    }

    // 验证并发送事件
    const validation = this.sseStateManager.validateAndSend(dataMap);
    if (validation.valid) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(dataMap)}\n\n`));
    }

    // 累计token（基于实际发送的内容）
    this.accumulateTokens(dataMap);
  }

  /**
   * 累计token数
   */
  private accumulateTokens(dataMap: Record<string, unknown>): void {
    const eventType = dataMap.type as string;

    switch (eventType) {
      case "content_block_delta": {
        const delta = dataMap.delta as Record<string, unknown>;
        if (!delta) break;

        const deltaType = delta.type as string;
        if (deltaType === "text_delta" && delta.text) {
          // 文本内容增量
          this.totalOutputTokens += this.tokenEstimator.estimateTextTokens(
            delta.text as string,
          );
        } else if (deltaType === "input_json_delta" && delta.partial_json) {
          // 工具调用参数JSON增量
          const jsonText = delta.partial_json as string;
          this.totalOutputTokens += Math.ceil(jsonText.length / 4);
        }
        break;
      }

      case "content_block_start": {
        const contentBlock = dataMap.content_block as Record<string, unknown>;
        if (!contentBlock) break;

        const blockType = contentBlock.type as string;
        if (blockType === "tool_use") {
          // 工具调用结构开销：12 tokens (type+id+name)
          this.totalOutputTokens += 12;
          
          // 工具名称token
          const toolName = contentBlock.name as string;
          if (toolName) {
            this.totalOutputTokens += this.tokenEstimator.estimateTextTokens(toolName);
          }
        }
        break;
      }
    }
  }

  /**
   * 发送结束事件
   */
  sendFinalEvents(controller: ReadableStreamDefaultController): void {
    const encoder = new TextEncoder();

    // 关闭所有未关闭的content_block
    for (const [index, block] of this.sseStateManager.getActiveBlocks().entries()) {
      if (block.started && !block.stopped) {
        const stopEvent = { type: "content_block_stop", index };
        const validation = this.sseStateManager.validateAndSend(stopEvent);
        if (validation.valid) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopEvent)}\n\n`));
        }
      }
    }

    // 更新工具调用状态
    const hasActiveTools = this.toolUseIdByBlockIndex.size > 0;
    const hasCompletedTools = this.completedToolUseIds.size > 0;

    this.stopReasonManager.updateToolCallStatus(hasActiveTools, hasCompletedTools);

    // 最小token保护
    let outputTokens = this.totalOutputTokens;
    if (outputTokens < 1 && (hasActiveTools || hasCompletedTools)) {
      outputTokens = 1;
    }

    // 确定stop_reason
    const stopReason = this.stopReasonManager.determineStopReason();

    logger.debug(
      "流式响应stop_reason决策",
      logger.String("request_id", this.requestId),
      logger.String("stop_reason", stopReason),
      logger.String("description", getStopReasonDescription(stopReason)),
      logger.Int("output_tokens", outputTokens),
    );

    // 发送message_delta事件
    const stopEvent = {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: Math.max(1, outputTokens) },
    };
    const validation2 = this.sseStateManager.validateAndSend(stopEvent);
    if (validation2.valid) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopEvent)}\n\n`));
    }

    // 发送message_stop事件
    const messageStopEvent = { type: "message_stop" };
    const validation3 = this.sseStateManager.validateAndSend(messageStopEvent);
    if (validation3.valid) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(messageStopEvent)}\n\n`));
    }
  }

  /**
   * 处理事件流
   */
  async processEventStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    controller: ReadableStreamDefaultController,
  ): Promise<void> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      this.totalReadBytes += value.length;

      const { events } = this.compliantParser.parseStream(chunk);
      this.totalProcessedEvents += events.length;

      for (const event of events) {
        this.processEvent(event, controller, encoder);
      }
    }

    logger.debug(
      "响应流结束",
      logger.String("request_id", this.requestId),
      logger.Int("total_read_bytes", this.totalReadBytes),
      logger.Int("total_events", this.totalProcessedEvents),
    );
  }
}

/**
 * 处理流式请求
 */
export function handleStreamRequest(
  anthropicReq: AnthropicRequest,
  tokenWithUsage: TokenWithUsage,
  requestId: string,
  upstreamResponse: Response,
): Response {
  const messageId = `msg_${crypto.randomUUID().replace(/-/g, "")}`;

  // 计算输入tokens
  const estimator = new TokenEstimator();
  const systemMessages = anthropicReq.system?.map(s => ({ text: typeof s === "string" ? s : s.text }));
  const inputTokens = estimator.estimateTokens({
    system: systemMessages,
    messages: anthropicReq.messages,
    tools: anthropicReq.tools,
  });

  const stream = new ReadableStream({
    async start(controller) {
      // 创建流处理上下文
      const ctx = new StreamProcessorContext(
        anthropicReq,
        tokenWithUsage,
        messageId,
        requestId,
        inputTokens,
      );

      try {
        // 检查上游响应
        if (!upstreamResponse.ok || !upstreamResponse.body) {
          const errorMapper = new ErrorMapper();
          const errorText = await upstreamResponse.text();
          const claudeError = errorMapper.mapCodeWhispererError(
            upstreamResponse.status,
            errorText,
          );
          const errorResp = errorMapper.createErrorResponse(claudeError);
          controller.enqueue(new TextEncoder().encode(await errorResp.text()));
          controller.close();
          return;
        }

        // 发送初始事件
        ctx.sendInitialEvents(controller);

        // 处理事件流
        const reader = upstreamResponse.body.getReader();
        await ctx.processEventStream(reader, controller);

        // 发送结束事件
        ctx.sendFinalEvents(controller);

        controller.close();
      } catch (error) {
        logger.error(
          "流式请求处理失败",
          logger.String("request_id", requestId),
          logger.Err(error),
        );
        controller.error(error);
      } finally {
        // 清理资源
        ctx.cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
