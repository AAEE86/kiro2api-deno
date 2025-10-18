/**
 * kiro2api - Deno Deploy 入口文件
 */

import { loadConfig } from "./deno-src/config.ts";
import { initLogger, info, error } from "./deno-src/logger.ts";
import { createAuthService } from "./deno-src/auth/auth_service.ts";
import { StreamProcessor } from "./deno-src/stream_processor.ts";
import { convertOpenAIToAnthropic } from "./deno-src/converter/openai_to_anthropic.ts";
import { getSupportedModels } from "./deno-src/config.ts";
import type { AnthropicRequest, OpenAIRequest, ErrorResponse, ModelsResponse } from "./deno-src/types.ts";

// 全局状态
let initialized = false;
let authService: any;
let streamProcessor: any;
let config: any;

async function initialize() {
  if (initialized) return;
  
  try {
    config = await loadConfig();
    initLogger(config.logLevel, config.logFormat);
    authService = await createAuthService(config.authConfigs);
    streamProcessor = new StreamProcessor(authService);
    initialized = true;
    info("kiro2api 初始化完成");
  } catch (err) {
    error("初始化失败", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: { type: "api_error", message } }, status);
}

function authMiddleware(req: Request): Response | null {
  const authHeader = req.headers.get("Authorization") || req.headers.get("x-api-key");
  if (!authHeader) {
    return jsonResponse({ error: { type: "authentication_error", message: "缺少认证信息" } }, 401);
  }
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token !== config.clientToken) {
    return jsonResponse({ error: { type: "authentication_error", message: "认证失败" } }, 401);
  }
  return null;
}

export default {
  async fetch(request: Request): Promise<Response> {
    try {
      await initialize();
      
      const url = new URL(request.url);
      const path = url.pathname;
      
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders() });
      }
      
      if (path === "/") {
        return new Response("kiro2api - Deno Edition", { headers: corsHeaders() });
      }
      
      if (path === "/api/tokens") {
        return jsonResponse(authService.getPoolStatus());
      }
      
      const authError = authMiddleware(request);
      if (authError) return authError;
      
      if (path === "/v1/models" && request.method === "GET") {
        const models = getSupportedModels();
        return jsonResponse({
          object: "list",
          data: models.map(id => ({ id, object: "model", created: Date.now(), owned_by: "anthropic" }))
        });
      }
      
      if (path === "/v1/messages" && request.method === "POST") {
        const body = await request.json() as AnthropicRequest;
        if (!body.model || !body.messages || !body.max_tokens) {
          return errorResponse("缺少必需字段", 400);
        }
        
        if (body.stream) {
          const stream = await streamProcessor.processStream(body);
          return new Response(stream, {
            headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...corsHeaders() }
          });
        }
        
        const response = await streamProcessor.processNonStream(body);
        return new Response(response, {
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        });
      }
      
      return errorResponse("Not Found", 404);
    } catch (err) {
      error("请求处理失败", { error: err instanceof Error ? err.message : String(err) });
      return errorResponse(err instanceof Error ? err.message : "内部错误");
    }
  }
};