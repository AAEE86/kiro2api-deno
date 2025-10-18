import { loadAuthConfigs } from "./config.ts";
import { TokenManager } from "./token_manager.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";

export class AuthService {
  private tokenManager: TokenManager;

  private constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  // Factory method to create AuthService
  static async create(): Promise<AuthService> {
    console.log("Creating AuthService...");

    const configs = await loadAuthConfigs();
    console.log(`Loaded ${configs.length} auth configuration(s)`);

    const tokenManager = new TokenManager(configs);

    // Warm up the first token
    try {
      await tokenManager.getBestToken();
      console.log("Token warmup successful");
    } catch (error) {
      console.warn("Token warmup failed:", error);
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
  getTokenPoolStatus() {
    return this.tokenManager.getTokenPoolStatus();
  }
}
