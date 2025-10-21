import type { AuthConfig } from "./config.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";
import * as logger from "../logger/logger.ts";
import { UsageLimitsChecker, calculateAvailableCount } from "./usage_checker.ts";
import { createTokenPreview, maskEmail, maskClientId } from "../utils/privacy.ts";
import { TokenCache } from "./token_cache.ts";
import { TokenRefresher } from "./token_refresher.ts";
import { TokenSelector } from "./token_selector.ts";

export class TokenManager {
  private configs: AuthConfig[];
  private cache: TokenCache;
  private refresher: TokenRefresher;
  private selector: TokenSelector;
  private isDestroyed = false;

  constructor(configs: AuthConfig[]) {
    this.configs = configs;
    this.cache = new TokenCache();
    this.refresher = new TokenRefresher();
    this.selector = new TokenSelector(configs, this.cache, this.refresher);
  }

  public destroy(): void {
    if (this.isDestroyed) {
      logger.debug("TokenManager 已经被销毁，跳过重复调用");
      return;
    }
    
    this.isDestroyed = true;
    
    this.cache.destroy();
    this.refresher.destroy();
    this.selector.destroy();
    
    logger.info("TokenManager 资源已完全清理");
  }

  async warmupAllTokens(): Promise<void> {
    logger.info(`开始预热 ${this.configs.length} 个 token...`);
    
    const results = await Promise.allSettled(
      this.configs.map(async (config, index) => {
        const cached = await this.refresher.refresh(index, config);
        this.cache.set(index, cached);
        this.selector.removeFromExhausted(index);
        logger.info(`Token ${index + 1}/${this.configs.length} 预热成功`);
      })
    );
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    logger.info(
      `Token 预热完成`,
      logger.Int("total", this.configs.length),
      logger.Int("successful", successful),
      logger.Int("failed", failed)
    );
  }

  async getBestToken(): Promise<TokenInfo> {
    const result = await this.getBestTokenWithUsage();
    return result.tokenInfo;
  }

  async getBestTokenWithUsage(): Promise<TokenWithUsage> {
    return await this.selector.selectBest();
  }



  async getTokenPoolStatus() {
    const tokenList: Array<Record<string, unknown>> = [];
    let activeCount = 0;
    const checker = new UsageLimitsChecker();

    for (let i = 0; i < this.configs.length; i++) {
      const config = this.configs[i];
      const cached = this.cache.get(i);

      if (!cached || this.cache.isExpired(cached.token)) {
        // Token not available or expired
        tokenList.push({
          index: i,
          user_email: "未获取",
          token_preview: createTokenPreview(config.refreshToken),
          auth_type: config.auth.toLowerCase(),
          remaining_usage: 0,
          expires_at: cached?.token.expiresAt?.toISOString() || new Date(Date.now() + 3600000).toISOString(),
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
        user_email: maskEmail(userEmail),
        token_preview: createTokenPreview(cached.token.accessToken || ""),
        auth_type: config.auth.toLowerCase(),
        remaining_usage: remainingUsage,
        expires_at: cached.token.expiresAt?.toISOString() || new Date(Date.now() + 3600000).toISOString(),
        last_used: new Date().toISOString(),
        status: isActive ? "active" : "exhausted",
      };

      // Add IdC specific info
      if (config.auth === "IdC" && config.clientId) {
        tokenData.client_id = maskClientId(config.clientId);
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
}
