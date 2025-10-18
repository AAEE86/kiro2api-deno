import type { TokenInfo, UsageLimits } from "../types/common.ts";

export class UsageLimitsChecker {
  async checkUsageLimits(tokenInfo: TokenInfo): Promise<UsageLimits | null> {
    try {
      const response = await fetch("https://codewhisperer.us-east-1.amazonaws.com/usage", {
        headers: {
          "Authorization": `Bearer ${tokenInfo.accessToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      
      return {
        totalLimit: data.usageLimit || 0,
        currentUsage: data.currentUsage || 0,
        remainingUsage: Math.max(0, (data.usageLimit || 0) - (data.currentUsage || 0)),
        isExceeded: (data.currentUsage || 0) >= (data.usageLimit || 0),
        resetDate: data.resetDate ? new Date(data.resetDate) : null,
      };
    } catch {
      return null;
    }
  }

  calculateAvailableCount(usage: UsageLimits): number {
    return Math.max(0, usage.remainingUsage);
  }
}