import { AuthService } from "./auth/auth_service.ts";
import {
  handleMessages,
  handleModels,
  handleTokenStatus,
} from "./server/handlers.ts";
import {
  handleGetTokens,
  handleAddToken,
  handleDeleteToken,
  handleImportTokens,
  handleClearTokens,
} from "./routes/token_admin.ts";
import { handleCountTokens } from "./server/count_tokens_handler.ts";
import { handleOpenAINonStreamRequest } from "./server/openai_handlers.ts";
import { handleOpenAIStreamRequest } from "./server/openai_stream_processor.ts";
import { createRequestContext } from "./server/request_context.ts";
import { openAIToAnthropic } from "./converter/converter.ts";
import { respondError } from "./server/common.ts";
import type { OpenAIRequest } from "./types/openai.ts";
import { requestIDMiddleware, validateAPIKey, requiresAuth, getCORSHeaders } from "./server/middleware.ts";
import { DEFAULTS } from "./config/constants.ts";
import * as logger from "./logger/logger.ts";
import { join } from "https://deno.land/std@0.208.0/path/mod.ts";

// Middleware to check authorization
function checkAuth(req: Request, clientToken: string): boolean {
  const url = new URL(req.url);
  const protectedPrefixes = ["/v1"];
  
  // Skip auth for non-protected endpoints
  if (!requiresAuth(url.pathname, protectedPrefixes)) {
    return true;
  }

  return validateAPIKey(req, clientToken);
}

// Serve static files
async function serveStaticFile(pathname: string): Promise<Response> {
  try {
    // Remove leading slash and "static/" prefix if present
    const filePath = pathname.startsWith("/static/") 
      ? pathname.substring("/static/".length)
      : pathname.substring(1);
    
    const fullPath = join(Deno.cwd(), "static", filePath);
    
    const file = await Deno.readFile(fullPath);
    
    // Determine content type based on file extension
    const ext = filePath.split(".").pop()?.toLowerCase();
    const contentTypes: Record<string, string> = {
      "html": "text/html; charset=utf-8",
      "css": "text/css; charset=utf-8",
      "js": "application/javascript; charset=utf-8",
      "json": "application/json",
      "png": "image/png",
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "gif": "image/gif",
      "svg": "image/svg+xml",
      "ico": "image/x-icon",
    };
    
    const contentType = contentTypes[ext || ""] || "application/octet-stream";
    
    return new Response(file, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch {
    logger.debug("Static file not found", logger.String("path", pathname));
    return new Response("Not Found", { status: 404 });
  }
}

// Main request handler
async function handleRequest(
  req: Request,
  authService: AuthService,
  clientToken: string,
): Promise<Response> {
  const url = new URL(req.url);

  // Generate request ID
  const requestId = requestIDMiddleware(req);
  
  // CORS headers
  const corsHeaders = getCORSHeaders();

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Check authentication
  if (!checkAuth(req, clientToken)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Route handling
  try {
    let response: Response;

    if (url.pathname === "/v1/models" && req.method === "GET") {
      response = await handleModels();
    } else if (url.pathname === "/api/tokens" && req.method === "GET") {
      response = await handleTokenStatus(authService);
    } else if (url.pathname === "/api/admin/tokens" && req.method === "GET") {
      response = await handleGetTokens(req);
    } else if (url.pathname === "/api/admin/tokens" && req.method === "POST") {
      response = await handleAddToken(req);
    } else if (url.pathname === "/api/admin/tokens" && req.method === "DELETE") {
      response = await handleDeleteToken(req);
    } else if (url.pathname === "/api/admin/tokens/import" && req.method === "POST") {
      response = await handleImportTokens(req);
    } else if (url.pathname === "/api/admin/tokens/clear" && req.method === "POST") {
      response = await handleClearTokens(req);
    } else if (url.pathname === "/v1/messages" && req.method === "POST") {
      response = await handleMessages(req, authService);
    } else if (url.pathname === "/v1/messages/count_tokens" && req.method === "POST") {
      response = await handleCountTokens(req);
    } else if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      // Handle OpenAI format requests using RequestContext
      const reqCtx = createRequestContext(req, authService, "OpenAI", requestId);
      const result = await reqCtx.getTokenWithUsageAndBody();
      
      // Check for errors
      if (result.length === 3) {
        response = result[2]; // Return error response
      } else {
        const [tokenWithUsage, body] = result;
        
        // Parse OpenAI request
        const openaiReq: OpenAIRequest = JSON.parse(new TextDecoder().decode(body));
        const anthropicReq = openAIToAnthropic(openaiReq);
        
        if (anthropicReq.stream) {
          response = await handleOpenAIStreamRequest(openaiReq, tokenWithUsage, requestId);
        } else {
          response = await handleOpenAINonStreamRequest(openaiReq, tokenWithUsage.tokenInfo, requestId);
        }
      }
    } else if (url.pathname === "/" && req.method === "GET") {
      // Serve the dashboard index page
      response = await serveStaticFile("/index.html");
    } else if (url.pathname === "/admin" && req.method === "GET") {
      // Serve the admin page
      response = await serveStaticFile("/admin.html");
    } else if (url.pathname.startsWith("/static/") && req.method === "GET") {
      // Serve static files (CSS, JS, images, etc.)
      response = await serveStaticFile(url.pathname);
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    // Add CORS headers and request ID to response
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      headers.set(key, value as string);
    });
    headers.set("X-Request-ID", requestId);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    logger.error(
      "请求处理失败",
      logger.String("request_id", requestId),
      logger.String("path", url.pathname),
      logger.Err(error),
    );
    const errorResponse = respondError("Internal server error", 500);
    const headers = new Headers(errorResponse.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      headers.set(key, value as string);
    });
    headers.set("X-Request-ID", requestId);
    
    return new Response(errorResponse.body, {
      status: errorResponse.status,
      statusText: errorResponse.statusText,
      headers,
    });
  }
}

// Global variables for cloud deployment
let globalAuthService: AuthService | null = null;
let globalClientToken: string | null | undefined = null;

// Initialize function (called once on startup)
async function initialize() {
  // Load environment variables from .env file if it exists (local only)
  try {
    const env = await Deno.readTextFile(".env");
    env.split("\n").forEach((line) => {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, key, value] = match;
        Deno.env.set(key.trim(), value.trim());
      }
    });
    logger.info("已加载 .env 文件");
  } catch {
    logger.info("未找到 .env 文件，使用环境变量");
  }

  // Reinitialize logger after loading env vars
  logger.reinitialize();

  // Get configuration
  globalClientToken = Deno.env.get("KIRO_CLIENT_TOKEN");

  if (!globalClientToken) {
    logger.fatal("致命错误: 未设置 KIRO_CLIENT_TOKEN 环境变量");
    throw new Error(
      "KIRO_CLIENT_TOKEN environment variable not set. Please configure it in your deployment settings.",
    );
  }

  // Create AuthService
  logger.info("正在创建 AuthService...");
  globalAuthService = await AuthService.create();
  logger.info("AuthService 初始化成功");
}

// Request handler wrapper with lazy initialization
async function handleRequestWithInit(req: Request): Promise<Response> {
  try {
    // Initialize on first request if not already done
    if (!globalAuthService || !globalClientToken) {
      await initialize();
    }

    return await handleRequest(req, globalAuthService!, globalClientToken!);
  } catch (error) {
    logger.error("请求处理错误", logger.Err(error));
    return new Response(
      JSON.stringify({
        error: "Service initialization failed",
        message: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Check if running in Deno Deploy
const isDenoDeployment = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

// Main function for local development only
async function main() {
  if (isDenoDeployment) {
    logger.info("在 Deno Deploy 环境中运行，跳过本地服务器设置");
    return;
  }

  const port = parseInt(Deno.env.get("PORT") || String(DEFAULTS.PORT));

  try {
    await initialize();

    logger.debug(
      "日志系统初始化完成",
      logger.String("config_level", Deno.env.get("LOG_LEVEL") || "info"),
      logger.String("config_file", Deno.env.get("LOG_FILE") || "none"),
    );

    logger.info(`正在启动服务器...`, logger.Int("port", port));

    Deno.serve({
      port,
      onListen: ({ hostname, port }) => {
        logger.info(
          `启动 Anthropic API 代理服务器`,
          logger.String("port", String(port)),
          logger.String("auth_token", "***"),
        );
        logger.info("AuthToken 验证已启用");
        logger.info("可用端点:");
        logger.info("  GET  /                        - Web 管理界面");
        logger.info("  GET  /api/tokens                  - Token 池状态 (API)");
        logger.info("  GET  /v1/models                   - 模型列表");
        logger.info("  POST /v1/messages                 - Anthropic API 代理");
        logger.info("  POST /v1/messages/count_tokens    - Token 计数接口");
        logger.info("  POST /v1/chat/completions         - OpenAI API 代理");
        logger.info("按 Ctrl+C 停止服务器");
        logger.info(`\n🚀 kiro2api (Deno) listening on http://${hostname}:${port}\n`);
        logger.info(`📊 Web Dashboard: http://${hostname}:${port}\n`);
      },
    }, handleRequestWithInit);
  } catch (error) {
    logger.fatal("启动服务器失败", logger.Err(error));
    throw error;
  }
}

// Export handler for Deno Deploy
export default { fetch: handleRequestWithInit };

// Run the server if executed directly and not in Deno Deploy
if (import.meta.main && !isDenoDeployment) {
  main().catch((error) => {
    logger.fatal("服务器启动失败", logger.Err(error));
  });
}
