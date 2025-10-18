import { loadAuthConfigs } from "./config.ts";
import { TokenManager } from "./token_manager.ts";
import { UsageLimitsChecker } from "./usage_checker.ts";
import { TokenWarmupService } from "./token_warmup.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";

export class AuthService {
  private tokenManager: TokenManager;
  private warmupService: TokenWarmupService;

  private constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
    this.warmupService = new TokenWarmupService(this);
  }

  // Factory method to create AuthService
  static async create(): Promise<AuthService> {
    console.log("Creating AuthService...");

    const configs = await loadAuthConfigs();
    console.log(`Loaded ${configs.length} auth configuration(s)`);

    const tokenManager = new TokenManager(configs);

    const authService = new AuthService(tokenManager);
    
    // Start warmup service
    authService.warmupService.start();
    
    return authService;
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

  // Get detailed token pool status with usage info
  async getDetailedTokenPoolStatus() {
    const basicStatus = this.tokenManager.getTokenPoolStatus();
    const checker = new UsageLimitsChecker();
    
    const tokensWithUsage = await Promise.all(
      basicStatus.tokens.map(async (token: any) => {
        try {
          const tokenInfo = await this.tokenManager.getBestToken();
          const usage = await checker.checkUsageLimits(tokenInfo);
          return {
            ...token,
            usage: usage ? {
              totalLimit: usage.totalLimit,
              currentUsage: usage.currentUsage,
              remainingUsage: usage.remainingUsage,
              isExceeded: usage.isExceeded,
            } : null,
          };
        } catch {
          return { ...token, usage: null };
        }
      })
    );

    return {
      ...basicStatus,
      tokens: tokensWithUsage,
    };
  }
}
