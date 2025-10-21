import type { OpenAIRequest } from "../types/openai.ts";
import type { TokenWithUsage } from "../types/common.ts";
import { openAIToAnthropic } from "../converter/converter.ts";
import { anthropicToCodeWhisperer } from "../converter/converter.ts";
import { AWS_ENDPOINTS } from "../config/constants.ts";
import { RobustEventStreamParser } from "../parser/robust_parser.ts";
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
  private readonly binaryParser: RobustEventStreamParser;

  // 工具调用映射
  private readonly toolIndexByToolUseId = new Map<string, number>();
  private readonly toolUseIdByBlockIndex = new Map<number, string>();
  private nextToolIndex = 0;
  private sawToolUse = false;

  // 异常处理
  private forcedFinishReason: string | null = null;

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
    this.binaryParser = new RobustEventStreamParser();
  }

  /**
   * 清理资源
   */
  cleanup(): void {
    this.binaryParser.reset();
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
   * 处理单个AWS EventStream消息并转换为OpenAI格式
   * 返回 true 表示应该终止流处理
   */
  processMessage(
    message: { payload: Uint8Array },
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ): boolean {
    // 解析 payload
    let event: Record<string, unknown>;
    try {
      const payload = JSON.parse(new TextDecoder().decode(message.payload));
      event = payload.assistantResponseEvent || payload;
    } catch {
      return false;
    }

    // 检查是否为异常事件
    if (this.handleExceptionEvent(event, controller, encoder)) {
      return true; // 终止流处理
    }

    // 处理文本内容
    if (event.content) {
      const contentEvent = {
        id: this.messageId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: this.openaiReq.model,
        choices: [{
          index: 0,
          delta: { content: event.content },
          finish_reason: null,
        }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(contentEvent)}\n\n`));
    }

    // 处理工具调用
    if (event.toolUseId && event.name) {
      const toolUseId = event.toolUseId as string;
      const toolName = event.name as string;
      
      // 分配工具索引
      if (!this.toolIndexByToolUseId.has(toolUseId)) {
        this.toolIndexByToolUseId.set(toolUseId, this.nextToolIndex);
        this.nextToolIndex++;
        this.sawToolUse = true;
        
        const toolIdx = this.toolIndexByToolUseId.get(toolUseId)!;
        
        // 发送工具调用开始
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
      
      // 处理工具参数
      if (event.input && typeof event.input === "string") {
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
                  function: { arguments: event.input },
                }],
              },
              finish_reason: null,
            }],
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolDelta)}\n\n`));
        }
      }
    }

    this.totalProcessedEvents++;
    return false;
  }

  /**
   * 处理上游异常事件
   * 返回 true 表示已处理异常并应终止流
   */
  private handleExceptionEvent(
    event: Record<string, unknown>,
    controller: ReadableStreamDefaultController,
    encoder: TextEncoder,
  ): boolean {
    // 提取异常类型
    const exceptionType = (event.exception_type as string) || (event.__type as string);

    // 检查是否为内容长度超限异常
    if (
      exceptionType === "ContentLengthExceededException" ||
      exceptionType?.includes("CONTENT_LENGTH_EXCEEDS")
    ) {
      logger.info(
        "检测到内容长度超限异常，映射为length finish_reason",
        logger.String("request_id", this.requestId),
        logger.String("exception_type", exceptionType),
        logger.String("openai_finish_reason", "length"),
      );

      // 强制设置 finish_reason 为 length（OpenAI格式）
      this.forcedFinishReason = "length";

      // 发送结束事件
      const finalEvent = {
        id: this.messageId,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: this.openaiReq.model,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "length",
        }],
      };
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(finalEvent)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));

      return true; // 已处理异常，终止流
    }

    // 其他类型的异常，不处理
    return false;
  }

  /**
   * 发送结束事件
   */
  sendFinalEvent(controller: ReadableStreamDefaultController, encoder: TextEncoder): void {
    // 优先使用强制设置的 finish_reason（用于异常处理）
    const finishReason = this.forcedFinishReason || (this.sawToolUse ? "tool_calls" : "stop");
    
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
    const encoder = new TextEncoder();
    let shouldTerminate = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // 直接解析二进制数据
      const messages = this.binaryParser.parseStream(value);

      for (const message of messages) {
        shouldTerminate = this.processMessage(message, controller, encoder);
        if (shouldTerminate) {
          logger.info(
            "检测到终止信号，停止OpenAI流处理",
            logger.String("request_id", this.requestId),
          );
          break;
        }
      }

      // 如果检测到终止信号，跳出读取循环
      if (shouldTerminate) {
        break;
      }
    }

    logger.debug(
      "OpenAI响应流结束",
      logger.String("request_id", this.requestId),
      logger.Bool("terminated_by_exception", shouldTerminate),
    );
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
      "x-amzn-kiro-agent-mode": "spec",
      "x-amz-user-agent": "aws-sdk-js/1.0.18 KiroIDE-0.2.13-66c23a8c5d15afabec89ef9954ef52a119f10d369df04d548fc6c1eac694b0d1",
      "user-agent": "aws-sdk-js/1.0.18 ua/2.1 os/darwin#25.0.0 lang/js md/nodejs#20.16.0 api/codewhispererstreaming#1.0.18 m/E KiroIDE-0.2.13-66c23a8c5d15afabec89ef9954ef52a119f10d369df04d548fc6c1eac694b0d1",
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
