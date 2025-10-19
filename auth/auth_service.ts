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

    // Warm up the first token
    try {
      await tokenManager.getBestToken();
      logger.info("Token 预热成功");
    } catch (error) {
      logger.warn("Token 预热失败", logger.Err(error));
    }

    return new AuthService(tokenManager);
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
