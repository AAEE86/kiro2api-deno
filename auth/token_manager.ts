import type { AuthConfig } from "./config.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";
import { refreshToken } from "./refresh.ts";
import * as logger from "../logger/logger.ts";
import { UsageLimitsChecker, calculateAvailableCount } from "./usage_checker.ts";
import { createTokenPreview, maskEmail, maskClientId } from "../utils/privacy.ts";
import { TOKEN_CACHE_CONFIG } from "../config/cache.ts";

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
  
  // 缓存清理配置
  private readonly CACHE_TTL_MS = TOKEN_CACHE_CONFIG.TTL_MS;
  private readonly CLEANUP_INTERVAL_MS = TOKEN_CACHE_CONFIG.CLEANUP_INTERVAL_MS;
  private readonly EXPIRY_BUFFER_MS = TOKEN_CACHE_CONFIG.EXPIRY_BUFFER_MS;
  private cleanupTimer?: number;

  constructor(configs: AuthConfig[]) {
    this.configs = configs;
    this.startCacheCleanup();
  }

  /**
   * 启动定期缓存清理任务
   * 防止内存泄漏
   */
  private startCacheCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, this.CLEANUP_INTERVAL_MS);
    
    logger.debug("缓存清理任务已启动", logger.Int("interval_ms", this.CLEANUP_INTERVAL_MS));
  }

  /**
   * 清理过期的缓存条目
   * 包括过期的 token 和长时间未使用的缓存
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;
    let expiredCount = 0;
    let staleCount = 0;
    
    for (const [key, cache] of this.tokenCache.entries()) {
      const age = now - cache.cachedAt.getTime();
      const isExpired = this.isTokenExpired(cache.token);
      const isStale = age > this.CACHE_TTL_MS;
      
      if (isExpired || isStale) {
        this.tokenCache.delete(key);
        cleanedCount++;
        if (isExpired) expiredCount++;
        if (isStale) staleCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(
        "清理过期缓存",
        logger.Int("total_cleaned", cleanedCount),
        logger.Int("expired", expiredCount),
        logger.Int("stale", staleCount),
        logger.Int("remaining", this.tokenCache.size)
      );
    }
  }

  /**
   * 停止缓存清理任务并清理所有资源
   * 用于优雅关闭
   *
   * 改进点：
   * 1. 添加了更彻底的资源清理
   * 2. 防止重复调用
   * 3. 确保所有引用都被释放
   */
  private isDestroyed = false;
  
  public destroy(): void {
    // 防止重复调用
    if (this.isDestroyed) {
      logger.debug("TokenManager 已经被销毁，跳过重复调用");
      return;
    }
    
    this.isDestroyed = true;
    
    // 清理定时器
    if (this.cleanupTimer !== undefined) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    
    // 清理所有缓存和锁
    // 先清理 refreshLocks 中的 Promise 引用
    for (const [key, promise] of this.refreshLocks.entries()) {
      // 尝试取消正在进行的刷新操作
      promise.catch(() => {
        // 忽略错误，只是为了确保 Promise 被处理
      });
    }
    this.refreshLocks.clear();
    
    // 清理 token 缓存
    this.tokenCache.clear();
    
    // 清理耗尽集合
    this.exhausted.clear();
    
    // 重置索引
    this.currentIndex = 0;
    
    // 清理配置引用（如果配置很大）
    // 注意：这里不清理 configs，因为可能还需要用于重新初始化
    
    logger.info("TokenManager 资源已完全清理");
  }

  // Warm up all tokens by refreshing them
  async warmupAllTokens(): Promise<void> {
    logger.info(`开始预热 ${this.configs.length} 个 token...`);
    
    const results = await Promise.allSettled(
      this.configs.map((config, index) => 
        this.getOrRefreshToken(index, config)
          .then(() => {
            logger.info(`Token ${index + 1}/${this.configs.length} 预热成功`);
          })
          .catch((error) => {
            logger.warn(
              `Token ${index + 1}/${this.configs.length} 预热失败`,
              logger.Err(error)
            );
          })
      )
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

  /**
   * 获取或刷新指定的 token
   * 使用双重检查锁定模式防止并发刷新
   */
  private async getOrRefreshToken(
    configIndex: number,
    config: AuthConfig,
  ): Promise<TokenInfo> {
    // 第一次检查（快速路径）
    const cached = this.tokenCache.get(configIndex);
    if (cached && !this.isTokenExpired(cached.token)) {
      return cached.token;
    }

    // 检查是否已有刷新进行中
    let existingRefresh = this.refreshLocks.get(configIndex);
    if (existingRefresh) {
      logger.debug(
        "等待现有刷新完成",
        logger.Int("config_index", configIndex)
      );
      return await existingRefresh;
    }

    // 创建刷新 Promise（包含二次检查）
    const refreshPromise = (async () => {
      // 再次检查缓存（可能在等待锁时已被刷新）
      const recheck = this.tokenCache.get(configIndex);
      if (recheck && !this.isTokenExpired(recheck.token)) {
        logger.debug(
          "缓存已在等待期间刷新",
          logger.Int("config_index", configIndex)
        );
        return recheck.token;
      }
      
      return await this.performRefresh(configIndex, config);
    })();

    // 设置刷新锁
    this.refreshLocks.set(configIndex, refreshPromise);

    try {
      const token = await refreshPromise;
      return token;
    } catch (error) {
      // 刷新失败时清理锁，允许重试
      this.refreshLocks.delete(configIndex);
      logger.error(
        "Token 刷新失败，已清理锁",
        logger.Int("config_index", configIndex),
        logger.Err(error)
      );
      throw error;
    }
  }

  /**
   * 执行实际的 token 刷新操作
   * 刷新成功后自动清理锁
   */
  private async performRefresh(
    configIndex: number,
    config: AuthConfig,
  ): Promise<TokenInfo> {
    const startTime = Date.now();
    
    logger.info(
      "开始刷新 token",
      logger.Int("config_index", configIndex),
      logger.String("auth_type", config.auth),
    );

    try {
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

      // 刷新成功后清理锁
      this.refreshLocks.delete(configIndex);

      const duration = Date.now() - startTime;
      logger.info(
        "Token 刷新成功",
        logger.Int("config_index", configIndex),
        logger.String("expires_at", token.expiresAt?.toISOString() || "unknown"),
        logger.Float("available", available),
        logger.Int("duration_ms", duration)
      );

      return token;
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error(
        "Token 刷新失败",
        logger.Int("config_index", configIndex),
        logger.Int("duration_ms", duration),
        logger.Err(error)
      );
      throw error;
    }
  }

  // Check if token is expired (with buffer from config)
  private isTokenExpired(token: TokenInfo): boolean {
    if (!token.expiresAt) return false;
    const now = new Date();
    return now.getTime() >= token.expiresAt.getTime() - this.EXPIRY_BUFFER_MS;
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
