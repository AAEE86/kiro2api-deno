/**
 * 认证服务
 * 提供统一的认证接口
 */

import type { AuthConfig, UsageLimits } from "../types.ts";
import { TokenManager } from "./token_manager.ts";
import * as logger from "../logger.ts";

// ============================================================================
// 认证服务
// ============================================================================

export class AuthService {
  private tokenManager: TokenManager;

  constructor(configs: AuthConfig[]) {
    this.tokenManager = new TokenManager(configs);
    logger.info("认证服务初始化完成");
  }

  /**
   * 获取访问 Token
   */
  async getAccessToken(): Promise<string> {
    return await this.tokenManager.getToken();
  }

  /**
   * 获取 Token 池状态
   */
  getPoolStatus() {
    return this.tokenManager.getPoolStatus();
  }

  /**
   * 清除缓存
   */
  clearCache(): void {
    this.tokenManager.clearCache();
  }

  /**
   * 检查使用限制
   */
  async checkUsageLimits(token: string): Promise<UsageLimits | null> {
    // TODO: 实现使用限制检查
    // 这需要调用 AWS API 获取使用情况
    // 暂时返回 null
    return null;
  }
}

/**
 * 创建认证服务实例
 */
export async function createAuthService(
  configs: AuthConfig[],
): Promise<AuthService> {
  return new AuthService(configs);
}
