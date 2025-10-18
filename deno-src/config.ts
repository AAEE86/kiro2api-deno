/**
 * 配置管理模块
 * 负责加载和管理应用配置
 */

import { load } from "@std/dotenv";
import type { AppConfig, AuthConfig, ModelMapping } from "./types.ts";

// ============================================================================
// 模型映射配置
// ============================================================================

export const MODEL_MAPPINGS: ModelMapping[] = [
  {
    publicName: "claude-sonnet-4-5-20250929",
    internalId: "CLAUDE_SONNET_4_5_20250929_V1_0",
    aliases: ["claude-sonnet-4-5", "sonnet-4-5"],
  },
  {
    publicName: "claude-sonnet-4-20250514",
    internalId: "CLAUDE_SONNET_4_20250514_V1_0",
    aliases: ["claude-sonnet-4", "sonnet-4", "claude-4"],
  },
  {
    publicName: "claude-3-7-sonnet-20250219",
    internalId: "CLAUDE_3_7_SONNET_20250219_V1_0",
    aliases: ["claude-3-7-sonnet", "sonnet-3-7"],
  },
  {
    publicName: "claude-3-5-haiku-20241022",
    internalId: "auto",
    aliases: ["claude-3-5-haiku", "haiku-3-5"],
  },
];

// ============================================================================
// 常量配置
// ============================================================================

export const CONSTANTS = {
  // AWS CodeWhisperer API
  CODEWHISPERER_API_URL:
    "https://codewhisperer.us-east-1.amazonaws.com/v1/conversations",
  CODEWHISPERER_STREAMING_API_URL:
    "https://codewhisperer.us-east-1.amazonaws.com/v1/streaming-conversations",

  // AWS SSO Token 刷新
  SSO_TOKEN_REFRESH_URL: "https://oidc.us-east-1.amazonaws.com/token",
  IDC_TOKEN_REFRESH_URL: "https://oidc.us-east-1.amazonaws.com/token",

  // Token 缓存时间（秒）
  TOKEN_CACHE_DURATION: 3600, // 1小时
  TOKEN_REFRESH_BUFFER: 300, // 提前5分钟刷新

  // 超时配置
  DEFAULT_TIMEOUT: 120000, // 120秒
  MAX_TIMEOUT: 600000, // 600秒

  // 限流配置
  MAX_CONCURRENT_REFRESHES: 3,
};

// ============================================================================
// 配置加载
// ============================================================================

/**
 * 加载认证配置
 */
async function loadAuthConfigs(): Promise<AuthConfig[]> {
  const authToken = Deno.env.get("KIRO_AUTH_TOKEN");

  if (!authToken) {
    throw new Error(
      "KIRO_AUTH_TOKEN 环境变量未设置。请配置认证信息。",
    );
  }

  // 尝试作为文件路径读取
  try {
    const stat = await Deno.stat(authToken);
    if (stat.isFile) {
      const content = await Deno.readTextFile(authToken);
      return JSON.parse(content) as AuthConfig[];
    }
  } catch {
    // 不是文件，继续尝试作为 JSON 字符串解析
  }

  // 作为 JSON 字符串解析
  try {
    return JSON.parse(authToken) as AuthConfig[];
  } catch (error) {
    throw new Error(
      `无法解析 KIRO_AUTH_TOKEN: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * 验证认证配置
 */
function validateAuthConfigs(configs: AuthConfig[]): void {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error("至少需要配置一个认证信息");
  }

  for (const [index, config] of configs.entries()) {
    if (!config.auth || !["Social", "IdC"].includes(config.auth)) {
      throw new Error(
        `配置 ${index}: auth 字段必须是 "Social" 或 "IdC"`,
      );
    }

    if (!config.refreshToken) {
      throw new Error(`配置 ${index}: refreshToken 字段是必需的`);
    }

    if (config.auth === "IdC") {
      if (!config.clientId || !config.clientSecret) {
        throw new Error(
          `配置 ${index}: IdC 认证需要 clientId 和 clientSecret`,
        );
      }
    }
  }
}

/**
 * 加载应用配置
 */
export async function loadConfig(): Promise<AppConfig> {
  // 加载 .env 文件（如果存在）
  try {
    await load({ export: true });
  } catch {
    // .env 文件不存在，使用环境变量
  }

  // 加载认证配置
  const authConfigs = await loadAuthConfigs();
  validateAuthConfigs(authConfigs);

  // 加载其他配置
  const port = parseInt(Deno.env.get("PORT") || "8080", 10);
  const clientToken = Deno.env.get("KIRO_CLIENT_TOKEN");

  if (!clientToken) {
    throw new Error(
      "KIRO_CLIENT_TOKEN 环境变量未设置。请设置 API 认证密钥。",
    );
  }

  const logLevel = (Deno.env.get("LOG_LEVEL") || "info") as
    | "debug"
    | "info"
    | "warn"
    | "error";
  const logFormat = (Deno.env.get("LOG_FORMAT") || "json") as "text" | "json";
  const ginMode = (Deno.env.get("GIN_MODE") || "release") as
    | "debug"
    | "release"
    | "test";

  return {
    port,
    clientToken,
    authConfigs,
    logLevel,
    logFormat,
    ginMode,
  };
}

/**
 * 获取模型映射
 */
export function getModelMapping(publicName: string): ModelMapping | undefined {
  // 精确匹配
  let mapping = MODEL_MAPPINGS.find((m) => m.publicName === publicName);
  if (mapping) return mapping;

  // 别名匹配
  mapping = MODEL_MAPPINGS.find((m) =>
    m.aliases?.includes(publicName)
  );
  if (mapping) return mapping;

  return undefined;
}

/**
 * 获取内部模型 ID
 */
export function getInternalModelId(publicName: string): string {
  const mapping = getModelMapping(publicName);
  return mapping?.internalId || "auto";
}

/**
 * 获取所有支持的模型
 */
export function getSupportedModels(): string[] {
  return MODEL_MAPPINGS.map((m) => m.publicName);
}
