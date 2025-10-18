/**
 * Token 管理器
 * 负责 Token 的缓存、刷新和选择策略
 */

import type { AuthConfig, CachedToken, TokenInfo, UsageLimits } from "../types.ts";
import { CONSTANTS } from "../config.ts";
import * as logger from "../logger.ts";

// ============================================================================
// Token 缓存（内存）
// ============================================================================

class TokenCache {
  private cache = new Map<number, CachedToken>();

  get(index: number): CachedToken | undefined {
    const cached = this.cache.get(index);
    if (!cached) return undefined;

    // 检查是否过期
    if (Date.now() >= cached.expiresAt) {
      this.cache.delete(index);
      return undefined;
    }

    return cached;
  }

  set(index: number, token: string, expiresIn: number): void {
    const expiresAt = Date.now() + expiresIn * 1000;
    this.cache.set(index, { token, expiresAt });
  }

  delete(index: number): void {
    this.cache.delete(index);
  }

  clear(): void {
    this.cache.clear();
  }

  has(index: number): boolean {
    return this.get(index) !== undefined;
  }
}

// ============================================================================
// Token 管理器
// ============================================================================

export class TokenManager {
  private configs: AuthConfig[];
  private cache: TokenCache;
  private tokenInfos: TokenInfo[];
  private currentIndex = 0;
  private refreshLocks = new Map<number, Promise<string>>();

  constructor(configs: AuthConfig[]) {
    this.configs = configs.filter((c) => !c.disabled);
    this.cache = new TokenCache();
    this.tokenInfos = this.configs.map((config, index) => ({
      configIndex: index,
      config,
      refreshing: false,
    }));

    logger.info("Token 管理器初始化完成", {
      total_tokens: this.configs.length,
      enabled_tokens: this.tokenInfos.length,
    });
  }

  /**
   * 获取可用的 Token（顺序选择策略）
   */
  async getToken(): Promise<string> {
    const startIndex = this.currentIndex;
    let attempts = 0;

    while (attempts < this.tokenInfos.length) {
      const tokenInfo = this.tokenInfos[this.currentIndex];

      try {
        // 尝试获取 Token
        const token = await this.getTokenForConfig(tokenInfo);

        // 成功，移动到下一个索引（顺序选择）
        this.currentIndex = (this.currentIndex + 1) % this.tokenInfos.length;

        logger.debug("获取 Token 成功", {
          config_index: tokenInfo.configIndex,
          auth_type: tokenInfo.config.auth,
        });

        return token;
      } catch (error) {
        logger.warn("Token 获取失败，尝试下一个", {
          config_index: tokenInfo.configIndex,
          error: error instanceof Error ? error.message : String(error),
        });

        // 移动到下一个索引
        this.currentIndex = (this.currentIndex + 1) % this.tokenInfos.length;
        attempts++;
      }
    }

    throw new Error("所有 Token 都不可用");
  }

  /**
   * 获取指定配置的 Token
   */
  private async getTokenForConfig(tokenInfo: TokenInfo): Promise<string> {
    const { configIndex, config } = tokenInfo;

    // 检查缓存
    const cached = this.cache.get(configIndex);
    if (cached) {
      // 检查是否需要提前刷新
      const timeUntilExpiry = cached.expiresAt - Date.now();
      if (timeUntilExpiry > CONSTANTS.TOKEN_REFRESH_BUFFER * 1000) {
        return cached.token;
      }

      // 需要刷新，但可以先返回当前 Token
      logger.debug("Token 即将过期，触发后台刷新", {
        config_index: configIndex,
        time_until_expiry: Math.floor(timeUntilExpiry / 1000),
      });

      // 异步刷新（不等待）
      this.refreshToken(tokenInfo).catch((error) => {
        logger.error("后台刷新 Token 失败", {
          config_index: configIndex,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return cached.token;
    }

    // 没有缓存，需要刷新
    return await this.refreshToken(tokenInfo);
  }

  /**
   * 刷新 Token
   */
  private async refreshToken(tokenInfo: TokenInfo): Promise<string> {
    const { configIndex, config } = tokenInfo;

    // 检查是否已经在刷新中（防止并发刷新）
    const existingRefresh = this.refreshLocks.get(configIndex);
    if (existingRefresh) {
      logger.debug("等待现有的 Token 刷新完成", { config_index: configIndex });
      return await existingRefresh;
    }

    // 创建刷新 Promise
    const refreshPromise = this._doRefreshToken(config, configIndex);
    this.refreshLocks.set(configIndex, refreshPromise);

    try {
      const token = await refreshPromise;
      return token;
    } finally {
      this.refreshLocks.delete(configIndex);
    }
  }

  /**
   * 执行 Token 刷新
   */
  private async _doRefreshToken(
    config: AuthConfig,
    configIndex: number,
  ): Promise<string> {
    logger.info("开始刷新 Token", {
      config_index: configIndex,
      auth_type: config.auth,
    });

    const startTime = Date.now();

    try {
      const url = config.auth === "Social"
        ? CONSTANTS.SSO_TOKEN_REFRESH_URL
        : CONSTANTS.IDC_TOKEN_REFRESH_URL;

      const body: Record<string, string> = {
        grant_type: "refresh_token",
        refresh_token: config.refreshToken,
      };

      if (config.auth === "IdC") {
        body.client_id = config.clientId!;
        body.client_secret = config.clientSecret!;
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Token 刷新失败: ${response.status} ${response.statusText} - ${errorText}`,
        );
      }

      const data = await response.json();
      const accessToken = data.access_token;
      const expiresIn = data.expires_in || CONSTANTS.TOKEN_CACHE_DURATION;

      // 缓存 Token
      this.cache.set(configIndex, accessToken, expiresIn);

      // 更新 TokenInfo
      const tokenInfo = this.tokenInfos[configIndex];
      tokenInfo.cachedToken = this.cache.get(configIndex);
      tokenInfo.lastRefreshTime = Date.now();
      tokenInfo.refreshing = false;

      const duration = Date.now() - startTime;
      logger.info("Token 刷新成功", {
        config_index: configIndex,
        auth_type: config.auth,
        expires_in: expiresIn,
        duration_ms: duration,
      });

      return accessToken;
    } catch (error) {
      logger.error("Token 刷新失败", {
        config_index: configIndex,
        auth_type: config.auth,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取 Token 池状态
   */
  getPoolStatus() {
    return {
      total: this.tokenInfos.length,
      available: this.tokenInfos.filter((t) => !t.refreshing).length,
      tokens: this.tokenInfos.map((t) => {
        const cached = this.cache.get(t.configIndex);
        return {
          index: t.configIndex,
          auth: t.config.auth,
          disabled: t.config.disabled || false,
          cached: !!cached,
          expiresIn: cached
            ? Math.floor((cached.expiresAt - Date.now()) / 1000)
            : undefined,
          lastRefresh: t.lastRefreshTime,
        };
      }),
    };
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.cache.clear();
    logger.info("Token 缓存已清除");
  }
}
