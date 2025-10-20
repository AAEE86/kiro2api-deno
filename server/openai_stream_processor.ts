import type { OpenAIRequest } from "../types/openai.ts";
import type { TokenWithUsage } from "../types/common.ts";
import { openAIToAnthropic } from "../converter/converter.ts";
import { anthropicToCodeWhisperer } from "../converter/converter.ts";
import { AWS_ENDPOINTS } from "../config/constants.ts";
import { CompliantEventStreamParser } from "../parser/compliant_event_stream_parser.ts";
import * as logger from "../logger/logger.ts";

/**
 * OpenAI流处理器上下文
 * 封装OpenAI流式请求处理的所有状态
 * 
 * 设计原则：
 * 1. 单一职责：专注于OpenAI格式的流式数据处理
 * 2. 状态封装：所有处理状态统一管理
 * 3. 格式转换：Anthropic SSE事件 → OpenAI delta格式
 */
export class OpenAIStreamProcessorContext {
  // 请求信息
  public readonly openaiReq: OpenAIRequest;
  public readonly tokenWithUsage: TokenWithUsage;
  public readonly messageId: string;
  public readonly requestId: string;

  // 流解析器
  private readonly compliantParser: CompliantEventStreamParser;

  // 工具调用映射
  private readonly toolIndexByToolUseId = new Map<string, number>();
  private readonly toolUseIdByBlockIndex = new Map<number, string>();
  private nextToolIndex = 0;
  private sawToolUse = false;

  // 统计信息
  public totalProcessedEvents = 0;

  constructor(
    openaiReq: OpenAIRequest,
    tokenWithUsage: TokenWithUsage,
    requestId: string,
  ) {
    this.openaiReq = openaiReq;
    this.tokenWithUsage = tokenWithUsage;
    this.requestId = requestId;
    this.messageId = `chatcmpl-${Date.now()}`;
    this.compliantParser = new CompliantEventStreamParser();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.compliantParser.reset();
    this.toolIndexByToolUseId.clear();
    this.toolUseIdByBlockIndex.clear();
  }

  /**
   * 发送初始事件
   */
  sendInitialEvent(controller: ReadableStreamDefaultController, encoder: TextEncoder): void {
    const initialEvent = {
      id: this.messageId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.openaiReq.model,
      choices: [{
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      }],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialEvent)}\n\n`));

    logger.debug(
      "发送OpenAI流式初始事件",
      logger.String("request_id", this.requestId),
      logger.String("message_id", this.messageId),
    );
  }

  /**
   * 处理单个Anthropic事件并转换为OpenAI格式
   */
  processEvent(
    event: { data: unknown },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ): void {
    const dataMap = event.data as Record<string, unknown>;
    if (!dataMap) return;

    const eventType = dataMap.type as string;

    switch (eventType) {
      case "content_block_start":
        this.handleContentBlockStart(dataMap, controller, encoder);
        break;

      case "content_block_delta":
        this.handleContentBlockDelta(dataMap, controller, encoder);
        break;

      case "content_block_stop":
        // OpenAI不需要显式的stop事件
        break;

      case "message_delta":
      case "message_stop":
        // 这些事件在sendFinalEvent中统一处理
        break;
    }

    this.totalProcessedEvents++;
  }

  /**
   * 处理content_block_start事件
   */
  private handleContentBlockStart(
    dataMap: Record<string, unknown>,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ): void {
    const contentBlock = dataMap.content_block as Record<string, unknown>;
    if (!contentBlock || contentBlock.type !== "tool_use") {
      return;
    }

    const toolUseId = contentBlock.id as string;
    const toolName = contentBlock.name as string;
    const blockIndex = dataMap.index as number;

    // 分配工具索引
    if (!this.toolIndexByToolUseId.has(toolUseId)) {
      this.toolIndexByToolUseId.set(toolUseId, this.nextToolIndex);
      this.nextToolIndex++;
    }
    this.toolUseIdByBlockIndex.set(blockIndex, toolUseId);
    this.sawToolUse = true;

    const toolIdx = this.toolIndexByToolUseId.get(toolUseId)!;

    // 发送工具调用开始事件
    const toolStart = {
      id: this.messageId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.openaiReq.model,
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

  /**
   * 处理content_block_delta事件
   */
  private handleContentBlockDelta(
    dataMap: Record<string, unknown>,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ): void {
    const delta = dataMap.delta as Record<string, unknown>;
    if (!delta) return;

    const deltaType = delta.type as string;

    if (deltaType === "text_delta" && delta.text) {
      // 文本内容增量
      const contentEvent = {
        id: this.messageId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: this.openaiReq.model,
        choices: [{
          index: 0,
          delta: { content: delta.text },
          finish_reason: null,
        }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentEvent)}\n\n`));
    } else if (deltaType === "input_json_delta" && delta.partial_json) {
      // 工具参数JSON增量
      const blockIndex = dataMap.index as number;
      const toolUseId = this.toolUseIdByBlockIndex.get(blockIndex);
      
      if (toolUseId) {
        const toolIdx = this.toolIndexByToolUseId.get(toolUseId);
        if (toolIdx !== undefined) {
          const toolDelta = {
            id: this.messageId,
            object: "chat.completion.chunk",
            created: Math.floor(Date.now() / 1000),
            model: this.openaiReq.model,
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
  }

  /**
   * 发送结束事件
   */
  sendFinalEvent(controller: ReadableStreamDefaultController, encoder: TextEncoder): void {
    const finishReason = this.sawToolUse ? "tool_calls" : "stop";
    
    const finalEvent = {
      id: this.messageId,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: this.openaiReq.model,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: finishReason,
      }],
    };
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalEvent)}\n\n`));
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));

    logger.debug(
      "OpenAI流式响应完成",
      logger.String("request_id", this.requestId),
      logger.String("finish_reason", finishReason),
      logger.Bool("saw_tool_use", this.sawToolUse),
      logger.Int("processed_events", this.totalProcessedEvents),
    );
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
      const { events } = this.compliantParser.parseStream(chunk);

      for (const event of events) {
        this.processEvent(event, controller, encoder);
      }
    }
  }
}

/**
 * 处理OpenAI格式的流式请求
 */
export async function handleOpenAIStreamRequest(
  openaiReq: OpenAIRequest,
  tokenWithUsage: TokenWithUsage,
  requestId: string,
): Promise<Response> {
  // 转换为Anthropic格式
  const anthropicReq = openAIToAnthropic(openaiReq);
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  logger.debug(
    "发送OpenAI流式请求到 CodeWhisperer",
    logger.String("request_id", requestId),
    logger.String("direction", "upstream_request"),
    logger.String("model", openaiReq.model),
  );

  // 发送到CodeWhisperer
  const upstreamResponse = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenWithUsage.tokenInfo.accessToken}`,
    },
    body: JSON.stringify(cwReq),
  });

  // 检查上游响应
  if (!upstreamResponse.ok || !upstreamResponse.body) {
    const errorText = await upstreamResponse.text();
    logger.error(
      "CodeWhisperer API错误",
      logger.String("request_id", requestId),
      logger.Int("status", upstreamResponse.status),
      logger.String("error", errorText),
    );
    
    // 返回OpenAI格式的错误
    return Response.json({
      error: {
        message: `CodeWhisperer API error: ${upstreamResponse.status}`,
        type: "server_error",
        code: "internal_error",
      },
    }, { status: upstreamResponse.status });
  }

  // 创建流式响应
  const stream = new ReadableStream({
    async start(controller) {
      const ctx = new OpenAIStreamProcessorContext(
        openaiReq,
        tokenWithUsage,
        requestId,
      );

      try {
        const encoder = new TextEncoder();

        // 发送初始事件
        ctx.sendInitialEvent(controller, encoder);

        // 处理事件流
        const reader = upstreamResponse.body!.getReader();
        await ctx.processEventStream(reader, controller);

        // 发送结束事件
        ctx.sendFinalEvent(controller, encoder);

        controller.close();
      } catch (error) {
        logger.error(
          "OpenAI流式处理失败",
          logger.String("request_id", requestId),
          logger.Err(error),
        );
        controller.error(error);
      } finally {
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
