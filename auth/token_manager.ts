import type { AuthConfig } from "./config.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";
import { refreshToken } from "./refresh.ts";
import * as logger from "../logger/logger.ts";
import { UsageLimitsChecker, calculateAvailableCount } from "./usage_checker.ts";

interface TokenCache {
  token: TokenInfo;
  configIndex: number;
  cachedAt: Date;
  lastUsed: Date;
  available: number;
  usageInfo?: unknown;
}

export class TokenManager {
  private configs: AuthConfig[];
  private tokenCache: Map<number, TokenCache> = new Map();
  private currentIndex = 0;
  private exhausted: Set<number> = new Set();
  private refreshLocks: Map<number, Promise<TokenInfo>> = new Map();

  constructor(configs: AuthConfig[]) {
    this.configs = configs;
  }

  // Get the best available token (sequential selection)
  async getBestToken(): Promise<TokenInfo> {
    const result = await this.getBestTokenWithUsage();
    return result.tokenInfo;
  }

  // Get token with usage information
  async getBestTokenWithUsage(): Promise<TokenWithUsage> {
    const maxAttempts = this.configs.length;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const configIndex = this.currentIndex;
      const config = this.configs[configIndex];

      try {
        // Check if token is exhausted
        const cached = this.tokenCache.get(configIndex);
        if (cached && cached.available <= 0) {
          this.exhausted.add(configIndex);
          this.currentIndex = (this.currentIndex + 1) % this.configs.length;
          logger.debug(
            "Token 已耗尽，切换到下一个",
            logger.Int("exhausted_index", configIndex),
            logger.Int("next_index", this.currentIndex)
          );
          continue;
        }

        // Get or refresh token
        const token = await this.getOrRefreshToken(configIndex, config);
        const cachedToken = this.tokenCache.get(configIndex)!;

        // Update usage
        const available = cachedToken.available;
        if (cachedToken.available > 0) {
          cachedToken.available--;
        }
        cachedToken.lastUsed = new Date();

        logger.debug(
          "选择 token",
          logger.Int("config_index", configIndex),
          logger.Float("available_before", available),
          logger.Float("available_after", cachedToken.available)
        );

        return {
          tokenInfo: token,
          configIndex,
          availableCount: available,
          isUsageExceeded: available <= 0,
        };
      } catch (error) {
        logger.error(
          "获取 token 失败",
          logger.Int("config_index", configIndex),
          logger.Err(error),
        );
        // Mark as exhausted and try next
        this.exhausted.add(configIndex);
        this.currentIndex = (this.currentIndex + 1) % this.configs.length;
      }
    }

    throw new Error("All token configurations failed");
  }

  // Get or refresh a specific token
  private async getOrRefreshToken(
    configIndex: number,
    config: AuthConfig,
  ): Promise<TokenInfo> {
    // Check cache first
    const cached = this.tokenCache.get(configIndex);
    if (cached && !this.isTokenExpired(cached.token)) {
      return cached.token;
    }

    // Check if refresh is already in progress
    const existingRefresh = this.refreshLocks.get(configIndex);
    if (existingRefresh) {
      return await existingRefresh;
    }

    // Start refresh
    const refreshPromise = this.performRefresh(configIndex, config);
    this.refreshLocks.set(configIndex, refreshPromise);

    try {
      const token = await refreshPromise;
      return token;
    } finally {
      this.refreshLocks.delete(configIndex);
    }
  }

  // Perform actual token refresh
  private async performRefresh(
    configIndex: number,
    config: AuthConfig,
  ): Promise<TokenInfo> {
    logger.info(
      "刷新 token",
      logger.Int("config_index", configIndex),
      logger.String("auth_type", config.auth),
    );

    const token = await refreshToken(config);

    // Check usage limits
    const checker = new UsageLimitsChecker();
    let available = 0;
    let usageInfo = null;

    try {
      usageInfo = await checker.checkUsageLimits(token);
      if (usageInfo) {
        available = calculateAvailableCount(usageInfo);
      }
    } catch (error) {
      logger.warn("检查使用限制失败", logger.Err(error));
    }

    // Cache the token with usage info
    this.tokenCache.set(configIndex, {
      token,
      configIndex,
      cachedAt: new Date(),
      lastUsed: new Date(),
      available,
      usageInfo,
    });

    // Remove from exhausted set
    this.exhausted.delete(configIndex);

    logger.info(
      "Token 刷新成功",
      logger.Int("config_index", configIndex),
      logger.String("expires_at", token.expiresAt.toISOString()),
      logger.Float("available", available)
    );

    return token;
  }

  // Check if token is expired (with 5 minute buffer)
  private isTokenExpired(token: TokenInfo): boolean {
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return now.getTime() >= token.expiresAt.getTime() - bufferMs;
  }

  // Get token pool status - matching Go version implementation
  async getTokenPoolStatus() {
    const tokenList: Array<Record<string, unknown>> = [];
    let activeCount = 0;
    const checker = new UsageLimitsChecker();

    // Iterate through all configs
    for (let i = 0; i < this.configs.length; i++) {
      const config = this.configs[i];
      const cached = this.tokenCache.get(i);

      // Check if token is cached and valid
      if (!cached || this.isTokenExpired(cached.token)) {
        // Token not available or expired
        tokenList.push({
          index: i,
          user_email: "未获取",
          token_preview: this.createTokenPreview(config.refreshToken),
          auth_type: config.auth.toLowerCase(),
          remaining_usage: 0,
          expires_at: cached?.token.expiresAt.toISOString() || new Date(Date.now() + 3600000).toISOString(),
          last_used: "未知",
          status: cached ? "expired" : "pending",
        });
        continue;
      }

      // Try to get usage limits from AWS
      let userEmail = "未知用户";
      let remainingUsage = 0;
      
      try {
        const usageLimits = await checker.checkUsageLimits(cached.token);
        
        if (usageLimits) {
          // Extract user email from usage limits
          if (usageLimits.userInfo?.email) {
            userEmail = usageLimits.userInfo.email;
          }
          
          // Calculate remaining usage
          remainingUsage = calculateAvailableCount(usageLimits);
        }
      } catch (error) {
        logger.debug(
          "获取使用限制失败，使用备用数据",
          logger.Int("index", i),
          logger.Err(error)
        );
      }
      
      // Fallback: try to extract from description or profileArn
      if (userEmail === "未知用户") {
        if (config.description) {
          const emailMatch = config.description.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
          if (emailMatch) {
            userEmail = emailMatch[0];
          } else {
            userEmail = config.description;
          }
        } else if (cached.token.profileArn) {
          const arnParts = cached.token.profileArn.split("/");
          if (arnParts.length > 0) {
            userEmail = arnParts[arnParts.length - 1];
          }
        }
      }

      const isActive = remainingUsage > 0;

      if (isActive) {
        activeCount++;
      }

      // Build token data
      const tokenData: Record<string, unknown> = {
        index: i,
        user_email: this.maskEmail(userEmail),
        token_preview: this.createTokenPreview(cached.token.accessToken),
        auth_type: config.auth.toLowerCase(),
        remaining_usage: remainingUsage,
        expires_at: cached.token.expiresAt.toISOString(),
        last_used: new Date().toISOString(),
        status: isActive ? "active" : "exhausted",
      };

      // Add IdC specific info
      if (config.auth === "IdC" && config.clientId) {
        if (config.clientId.length > 10) {
          tokenData.client_id = config.clientId.substring(0, 5) + "***" + 
                                 config.clientId.substring(config.clientId.length - 3);
        } else {
          tokenData.client_id = config.clientId;
        }
      }

      tokenList.push(tokenData);
    }

    // Return format matching Go version
    return {
      timestamp: new Date().toISOString(),
      total_tokens: tokenList.length,
      active_tokens: activeCount,
      tokens: tokenList,
      pool_stats: {
        total_tokens: this.configs.length,
        active_tokens: activeCount,
      },
    };
  }

  // Create token preview (***+last 10 chars) - matching Go version
  private createTokenPreview(token: string): string {
    if (token.length <= 10) {
      return "*".repeat(token.length);
    }
    const suffix = token.substring(token.length - 10);
    return "***" + suffix;
  }

  // Mask email for privacy - matching Go version
  private maskEmail(email: string): string {
    if (!email || email === "未知用户" || email === "未获取") {
      return email;
    }

    // Split email into username and domain
    const parts = email.split("@");
    if (parts.length !== 2) {
      // Not a valid email format
      return email;
    }

    const username = parts[0];
    const domain = parts[1];

    // Mask username: keep first 2 and last 2 chars
    let maskedUsername: string;
    if (username.length <= 4) {
      maskedUsername = "*".repeat(username.length);
    } else {
      const prefix = username.substring(0, 2);
      const suffix = username.substring(username.length - 2);
      const middleLen = username.length - 4;
      maskedUsername = prefix + "*".repeat(middleLen) + suffix;
    }

    // Mask domain: keep TLD and second-level domain
    const domainParts = domain.split(".");
    let maskedDomain: string;

    if (domainParts.length === 1) {
      maskedDomain = "*".repeat(domain.length);
    } else if (domainParts.length === 2) {
      // e.g., gmail.com -> *****.com
      maskedDomain = "*".repeat(domainParts[0].length) + "." + domainParts[1];
    } else {
      // e.g., sun.edu.pl -> ***.edu.pl
      const maskedParts: string[] = [];
      for (let i = 0; i < domainParts.length - 2; i++) {
        maskedParts.push("*".repeat(domainParts[i].length));
      }
      // Keep last two levels
      maskedParts.push(domainParts[domainParts.length - 2]);
      maskedParts.push(domainParts[domainParts.length - 1]);
      maskedDomain = maskedParts.join(".");
    }

    return maskedUsername + "@" + maskedDomain;
  }
}
