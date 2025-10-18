import type { TokenInfo } from "../types/common.ts";
import { UsageLimitsChecker } from "./usage_checker.ts";

export class TokenWarmupService {
  private warmupInterval: number | null = null;
  private healthCheckInterval: number | null = null;

  constructor(
    private authService: any,
    private warmupIntervalMs = 300000, // 5 minutes
    private healthCheckIntervalMs = 60000, // 1 minute
  ) {}

  start(): void {
    this.performInitialWarmup();
    this.startPeriodicWarmup();
    this.startHealthCheck();
  }

  stop(): void {
    if (this.warmupInterval) {
      clearInterval(this.warmupInterval);
      this.warmupInterval = null;
    }
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async performInitialWarmup(): Promise<void> {
    try {
      console.log("Performing initial token warmup...");
      await this.authService.getToken();
      console.log("Initial token warmup completed");
    } catch (error) {
      console.warn("Initial token warmup failed:", error);
    }
  }

  private startPeriodicWarmup(): void {
    this.warmupInterval = setInterval(async () => {
      try {
        await this.authService.getToken();
        console.log("Token warmup completed");
      } catch (error) {
        console.warn("Token warmup failed:", error);
      }
    }, this.warmupIntervalMs);
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(async () => {
      try {
        const tokenInfo = await this.authService.getToken();
        await this.checkTokenHealth(tokenInfo);
      } catch (error) {
        console.warn("Token health check failed:", error);
      }
    }, this.healthCheckIntervalMs);
  }

  private async checkTokenHealth(tokenInfo: TokenInfo): Promise<void> {
    const checker = new UsageLimitsChecker();
    const usage = await checker.checkUsageLimits(tokenInfo);
    
    if (usage?.isExceeded) {
      console.warn("Token usage limit exceeded");
    }
    
    const timeUntilExpiry = tokenInfo.expiresAt.getTime() - Date.now();
    if (timeUntilExpiry < 300000) { // 5 minutes
      console.warn("Token expires soon, consider refreshing");
    }
  }
}