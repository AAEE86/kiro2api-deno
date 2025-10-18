import type { AuthConfig } from "./config.ts";
import type { TokenInfo, TokenWithUsage } from "../types/common.ts";
import { refreshToken } from "./refresh.ts";

interface TokenCache {
  token: TokenInfo;
  configIndex: number;
}

export class TokenManager {
  private configs: AuthConfig[];
  private tokenCache: Map<number, TokenCache> = new Map();
  private currentIndex = 0;
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
      try {
        const configIndex = this.currentIndex;
        const config = this.configs[configIndex];

        // Get or refresh token
        const token = await this.getOrRefreshToken(configIndex, config);

        // Move to next token for next request (sequential rotation)
        this.currentIndex = (this.currentIndex + 1) % this.configs.length;

        return {
          tokenInfo: token,
          configIndex,
        };
      } catch (error) {
        console.error(
          `Failed to get token for config ${this.currentIndex}:`,
          error,
        );
        // Try next config
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
    console.log(`Refreshing token for config ${configIndex} (${config.auth})`);

    const token = await refreshToken(config);

    // Cache the token
    this.tokenCache.set(configIndex, {
      token,
      configIndex,
    });

    console.log(
      `Token refreshed successfully for config ${configIndex}, expires at ${token.expiresAt}`,
    );

    return token;
  }

  // Check if token is expired (with 5 minute buffer)
  private isTokenExpired(token: TokenInfo): boolean {
    const now = new Date();
    const bufferMs = 5 * 60 * 1000; // 5 minutes
    return now.getTime() >= token.expiresAt.getTime() - bufferMs;
  }

  // Get token pool status
  getTokenPoolStatus() {
    return {
      total: this.configs.length,
      currentIndex: this.currentIndex,
      cached: this.tokenCache.size,
      configs: this.configs.map((config, index) => {
        const cached = this.tokenCache.get(index);
        return {
          index,
          auth: config.auth,
          description: config.description,
          cached: !!cached,
          expiresAt: cached?.token.expiresAt,
        };
      }),
    };
  }
}
