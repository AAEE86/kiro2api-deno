/**
 * HTTP 服务器
 * 提供 Anthropic 和 OpenAI 兼容的 API 端点
 */

import type {
  AnthropicRequest,
  AppConfig,
  ErrorResponse,
  ModelsResponse,
  OpenAIRequest,
} from "./types.ts";
import { AuthService } from "./auth/auth_service.ts";
import { StreamProcessor } from "./stream_processor.ts";
import { convertOpenAIToAnthropic } from "./converter/openai_to_anthropic.ts";
import { getSupportedModels } from "./config.ts";
import * as logger from "./logger.ts";

// ============================================================================
// 中间件
// ============================================================================

/**
 * 认证中间件
 */
function authMiddleware(
  req: Request,
  clientToken: string,
): Response | null {
  const authHeader = req.headers.get("Authorization") ||
    req.headers.get("x-api-key");

  if (!authHeader) {
    return jsonResponse(
      {
        error: {
          type: "authentication_error",
          message: "缺少认证信息",
        },
      },
      401,
    );
  }

  const token = authHeader.replace(/^Bearer\s+/i, "");

  if (token !== clientToken) {
    return jsonResponse(
      {
        error: {
          type: "authentication_error",
          message: "认证失败",
        },
      },
      401,
    );
  }

  return null;
}

/**
 * CORS 中间件
 */
function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * JSON 响应
 */
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

/**
 * SSE 响应
 */
function sseResponse(stream: ReadableStream<Uint8Array>): Response {
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      ...corsHeaders(),
    },
  });
}

/**
 * 错误响应
 */
function errorResponse(message: string, status = 500): Response {
  const error: ErrorResponse = {
    error: {
      type: "api_error",
      message,
    },
  };
  return jsonResponse(error, status);
}

// ============================================================================
// 路由处理器
// ============================================================================

/**
 * 根路径处理器
 */
function handleRoot(): Response {
  return new Response("kiro2api - Deno Edition", {
    headers: corsHeaders(),
  });
}

/**
 * 模型列表处理器
 */
function handleModels(): Response {
  const models = getSupportedModels();
  const response: ModelsResponse = {
    object: "list",
    data: models.map((id) => ({
      id,
      object: "model",
      created: Date.now(),
      owned_by: "anthropic",
    })),
  };
  return jsonResponse(response);
}

/**
 * Token 池状态处理器
 */
function handleTokenStatus(authService: AuthService): Response {
  const status = authService.getPoolStatus();
  return jsonResponse(status);
}

/**
 * Anthropic Messages 处理器
 */
async function handleAnthropicMessages(
  req: Request,
  streamProcessor: StreamProcessor,
): Promise<Response> {
  try {
    const body = await req.json() as AnthropicRequest;

    // 验证请求
    if (!body.model || !body.messages || !body.max_tokens) {
      return errorResponse("缺少必需字段: model, messages, max_tokens", 400);
    }

    logger.info("处理 Anthropic 请求", {
      model: body.model,
      stream: body.stream || false,
      messages_count: body.messages.length,
    });

    // 流式响应
    if (body.stream) {
      const stream = await streamProcessor.processStream(body);
      return sseResponse(stream);
    }

    // 非流式响应
    const response = await streamProcessor.processNonStream(body);
    return new Response(response, {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
      },
    });
  } catch (error) {
    logger.error("处理 Anthropic 请求失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "请求处理失败",
    );
  }
}

/**
 * OpenAI Chat Completions 处理器
 */
async function handleOpenAIChatCompletions(
  req: Request,
  streamProcessor: StreamProcessor,
): Promise<Response> {
  try {
    const body = await req.json() as OpenAIRequest;

    // 验证请求
    if (!body.model || !body.messages) {
      return errorResponse("缺少必需字段: model, messages", 400);
    }

    logger.info("处理 OpenAI 请求", {
      model: body.model,
      stream: body.stream || false,
      messages_count: body.messages.length,
    });

    // 转换为 Anthropic 格式
    const anthropicReq = convertOpenAIToAnthropic(body);

    // 流式响应
    if (body.stream) {
      const stream = await streamProcessor.processStream(anthropicReq);
      // TODO: 需要将 Anthropic SSE 转换为 OpenAI SSE 格式
      return sseResponse(stream);
    }

    // 非流式响应
    const response = await streamProcessor.processNonStream(anthropicReq);
    // TODO: 需要将 Anthropic 响应转换为 OpenAI 格式
    return new Response(response, {
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders(),
      },
    });
  } catch (error) {
    logger.error("处理 OpenAI 请求失败", {
      error: error instanceof Error ? error.message : String(error),
    });
    return errorResponse(
      error instanceof Error ? error.message : "请求处理失败",
    );
  }
}

// ============================================================================
// 服务器
// ============================================================================

/**
 * 创建请求处理器
 */
function createHandler(
  config: AppConfig,
  authService: AuthService,
  streamProcessor: StreamProcessor,
) {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;

    // OPTIONS 请求（CORS 预检）
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // 根路径
    if (path === "/") {
      return handleRoot();
    }

    // Token 池状态（无需认证）
    if (path === "/api/tokens") {
      return handleTokenStatus(authService);
    }

    // 其他路径需要认证
    const authError = authMiddleware(req, config.clientToken);
    if (authError) {
      return authError;
    }

    // 模型列表
    if (path === "/v1/models" && req.method === "GET") {
      return handleModels();
    }

    // Anthropic Messages API
    if (path === "/v1/messages" && req.method === "POST") {
      return await handleAnthropicMessages(req, streamProcessor);
    }

    // OpenAI Chat Completions API
    if (path === "/v1/chat/completions" && req.method === "POST") {
      return await handleOpenAIChatCompletions(req, streamProcessor);
    }

    // 404
    return errorResponse("Not Found", 404);
  };
}

/**
 * 启动服务器
 */
export async function startServer(
  config: AppConfig,
  authService: AuthService,
): Promise<void> {
  const streamProcessor = new StreamProcessor(authService);
  const handler = createHandler(config, authService, streamProcessor);

  logger.info("启动 HTTP 服务器", {
    port: config.port,
    log_level: config.logLevel,
  });

  await Deno.serve({
    port: config.port,
    handler,
    onListen: ({ hostname, port }) => {
      logger.info("服务器启动成功", {
        url: `http://${hostname}:${port}`,
      });
    },
  }).finished;
}
