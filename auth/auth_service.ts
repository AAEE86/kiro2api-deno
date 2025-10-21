import { loadAuthConfigs } from "./config.ts";
import { TokenManager } from "./token_manager.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";
import * as logger from "../logger/logger.ts";

export class AuthService {
  private tokenManager: TokenManager;

  private constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  // Factory method to create AuthService
  static async create(): Promise<AuthService> {
    logger.info("正在创建 AuthService...");

    const configs = await loadAuthConfigs();
    logger.info(`已加载 ${configs.length} 个认证配置`);

    const tokenManager = new TokenManager(configs);

    // Warm up all tokens
    try {
      await tokenManager.warmupAllTokens();
    } catch (error) {
      logger.warn("Token 预热失败", logger.Err(error));
    }

    return new AuthService(tokenManager);
  }

  // Reload configurations from KV
  async reload(): Promise<void> {
    logger.info("正在重新加载认证配置...");
    
    const configs = await loadAuthConfigs();
    logger.info(`重新加载了 ${configs.length} 个认证配置`);
    
    this.tokenManager = new TokenManager(configs);
    
    // Warm up all tokens
    try {
      await this.tokenManager.warmupAllTokens();
    } catch (error) {
      logger.warn("Token 预热失败", logger.Err(error));
    }
  }

  // Get a valid token
  async getToken(): Promise<TokenInfo> {
    return await this.tokenManager.getBestToken();
  }

  // Get token with usage information
  async getTokenWithUsage(): Promise<TokenWithUsage> {
    return await this.tokenManager.getBestTokenWithUsage();
  }

  // Get token pool status
  async getTokenPoolStatus() {
    return await this.tokenManager.getTokenPoolStatus();
  }
}
