import { KVStore } from "../auth/kv_store.ts";
import type { AuthConfig } from "../auth/config.ts";
import { getCORSHeaders } from "../server/middleware.ts";
import { AuthService } from "../auth/auth_service.ts";
import * as logger from "../logger/logger.ts";

/**
 * 获取所有 tokens
 */
export async function handleGetTokens(req: Request, authService?: AuthService): Promise<Response> {
  const corsHeaders = getCORSHeaders();

  try {
    const kvStore = await KVStore.create();
    const configs = await kvStore.getAuthConfigs();
    kvStore.close();

    // 脱敏处理，不返回完整的 refreshToken
    const sanitizedConfigs = (configs || []).map(config => ({
      auth: config.auth,
      refreshToken: maskToken(config.refreshToken),
      clientId: config.clientId,
      disabled: config.disabled,
      description: config.description,
    }));

    return new Response(JSON.stringify({ 
      success: true, 
      tokens: sanitizedConfigs,
      count: sanitizedConfigs.length 
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("Failed to get tokens", logger.Err(error));
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Failed to get tokens" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * 添加单个 token
 */
export async function handleAddToken(req: Request, authService?: AuthService): Promise<Response> {
  const corsHeaders = getCORSHeaders();

  try {
    const body = await req.json();
    const config: AuthConfig = body;

    // 验证必填字段
    if (!config.auth || !config.refreshToken) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Missing required fields: auth, refreshToken" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 验证 IdC 配置
    if (config.auth === "IdC" && (!config.clientId || !config.clientSecret)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "IdC auth requires clientId and clientSecret" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kvStore = await KVStore.create();
    const success = await kvStore.addAuthConfig(config);
    kvStore.close();

    if (success) {
      // Reload AuthService to pick up new token
      if (authService) {
        try {
          await authService.reload();
          logger.info("已重新加载 AuthService");
        } catch (error) {
          logger.error("重新加载 AuthService 失败", logger.Err(error));
        }
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Token added successfully" 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Failed to add token" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    logger.error("Failed to add token", logger.Err(error));
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Invalid request body" 
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * 删除指定 token
 */
export async function handleDeleteToken(req: Request, authService?: AuthService): Promise<Response> {
  const corsHeaders = getCORSHeaders();

  try {
    const body = await req.json();
    const { refreshToken } = body;

    if (!refreshToken) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Missing refreshToken" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const kvStore = await KVStore.create();
    const success = await kvStore.deleteAuthConfig(refreshToken);
    kvStore.close();

    if (success) {
      // Reload AuthService to pick up changes
      if (authService) {
        try {
          await authService.reload();
          logger.info("已重新加载 AuthService");
        } catch (error) {
          logger.error("重新加载 AuthService 失败", logger.Err(error));
        }
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: "Token deleted successfully" 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Token not found" 
      }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    logger.error("Failed to delete token", logger.Err(error));
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Invalid request body" 
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * 批量导入 tokens (一行一个 refreshToken)
 */
export async function handleImportTokens(req: Request, authService?: AuthService): Promise<Response> {
  const corsHeaders = getCORSHeaders();

  try {
    const body = await req.json();
    const { tokens, mode } = body; // mode: 'append' 或 'replace'

    if (!tokens || !Array.isArray(tokens)) {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Invalid tokens format, expected array of AuthConfig" 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 验证每个 token 配置
    for (const config of tokens) {
      if (!config.auth || !config.refreshToken) {
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Invalid token config: missing auth or refreshToken" 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const kvStore = await KVStore.create();
    let success = false;

    if (mode === 'append') {
      // 追加模式：保留现有的 tokens
      const existingConfigs = await kvStore.getAuthConfigs() || [];
      const allConfigs = [...existingConfigs, ...tokens];
      success = await kvStore.saveAuthConfigs(allConfigs);
    } else {
      // 替换模式：覆盖现有的 tokens
      success = await kvStore.importAuthConfigs(tokens);
    }

    kvStore.close();

    if (success) {
      // Reload AuthService to pick up new tokens
      if (authService) {
        try {
          await authService.reload();
          logger.info("已重新加载 AuthService");
        } catch (error) {
          logger.error("重新加载 AuthService 失败", logger.Err(error));
        }
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: `Successfully imported ${tokens.length} tokens`,
        count: tokens.length
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Failed to import tokens" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    logger.error("Failed to import tokens", logger.Err(error));
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Invalid request body" 
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

/**
 * 清空所有 tokens
 */
export async function handleClearTokens(req: Request, authService?: AuthService): Promise<Response> {
  const corsHeaders = getCORSHeaders();

  try {
    const kvStore = await KVStore.create();
    const success = await kvStore.clearAuthConfigs();
    kvStore.close();

    if (success) {
      // Note: After clearing, AuthService will fall back to env var
      if (authService) {
        try {
          await authService.reload();
          logger.info("已重新加载 AuthService（将使用环境变量）");
        } catch (error) {
          logger.error("重新加载 AuthService 失败", logger.Err(error));
        }
      }
      
      return new Response(JSON.stringify({ 
        success: true, 
        message: "All tokens cleared successfully" 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else {
      return new Response(JSON.stringify({ 
        success: false, 
        error: "Failed to clear tokens" 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    logger.error("Failed to clear tokens", logger.Err(error));
    return new Response(JSON.stringify({ 
      success: false, 
      error: "Failed to clear tokens" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// 工具函数：脱敏 token，只显示前后几位
function maskToken(token: string): string {
  if (!token || token.length < 10) return "***";
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
}
