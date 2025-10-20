import type { Token } from "./token.ts";

// Free trial information
export interface FreeTrialInfo {
  freeTrialExpiry: number;
  freeTrialStatus: string;
  usageLimit: number;
  usageLimitWithPrecision: number;
  currentUsage: number;
  currentUsageWithPrecision: number;
}

// Usage breakdown details
export interface UsageBreakdown {
  nextDateReset: number;
  overageCharges: number;
  resourceType: string;
  unit: string;
  usageLimit: number;
  usageLimitWithPrecision: number;
  overageRate: number;
  currentUsage: number;
  currentUsageWithPrecision: number;
  overageCap: number;
  overageCapWithPrecision: number;
  currency: string;
  currentOverages: number;
  currentOveragesWithPrecision: number;
  freeTrialInfo?: FreeTrialInfo;
  displayName: string;
  displayNamePlural: string;
}

// User information
export interface UserInfo {
  email: string;
  userId: string;
}

// Overage configuration
export interface OverageConfig {
  overageStatus: string;
}

// Subscription information
export interface SubscriptionInfo {
  subscriptionManagementTarget: string;
  overageCapability: string;
  subscriptionTitle: string;
  type: string;
  upgradeCapability: string;
}

// Usage limits response structure (based on token.md API spec)
export interface UsageLimits {
  limits: unknown[];
  usageBreakdownList: UsageBreakdown[];
  userInfo: UserInfo;
  daysUntilReset: number;
  overageConfiguration: OverageConfig;
  nextDateReset: number;
  subscriptionInfo: SubscriptionInfo;
  usageBreakdown: unknown;
}

// Token with usage status (extends Token)
export interface TokenWithUsage extends Token {
  usageLimits?: UsageLimits;
  availableCount: number;
  lastUsageCheck: Date;
  isUsageExceeded: boolean;
  usageCheckError?: string;
  userEmail?: string;
  tokenPreview?: string;
}

// Calculate available count based on CREDIT resource type
export function getAvailableCount(token: TokenWithUsage): number {
  if (!token.usageLimits) return 0;

  for (const breakdown of token.usageLimits.usageBreakdownList) {
    if (breakdown.resourceType === "CREDIT") {
      let totalAvailable = 0;

      // Prioritize free trial quota if exists and active
      if (breakdown.freeTrialInfo?.freeTrialStatus === "ACTIVE") {
        const freeTrialAvailable = 
          breakdown.freeTrialInfo.usageLimitWithPrecision - 
          breakdown.freeTrialInfo.currentUsageWithPrecision;
        totalAvailable += freeTrialAvailable;
      }

      // Add base quota
      const baseAvailable = 
        breakdown.usageLimitWithPrecision - 
        breakdown.currentUsageWithPrecision;
      totalAvailable += baseAvailable;

      return totalAvailable < 0 ? 0 : totalAvailable;
    }
  }

  return 0;
}

// Check if token is usable (considering expiration and usage limits)
export function isTokenUsable(token: TokenWithUsage): boolean {
  // Check if token is expired
  if (token.expiresAt && new Date() > token.expiresAt) {
    return false;
  }

  // Check usage limits
  if (token.isUsageExceeded) {
    return false;
  }

  // Check available count
  return getAvailableCount(token) > 0;
}

// Check if usage refresh is needed
export function needsUsageRefresh(
  token: TokenWithUsage,
  cacheTTL: number
): boolean {
  // Never checked usage status
  if (!token.usageLimits) return true;

  // Last check exceeded cache TTL
  if (Date.now() - token.lastUsageCheck.getTime() > cacheTTL) {
    return true;
  }

  // Last check had error
  if (token.usageCheckError) return true;

  return false;
}

// Generate token preview string (*** + last 10 chars)
export function generateTokenPreview(accessToken: string): string {
  if (accessToken.length <= 10) {
    return "*".repeat(accessToken.length);
  }
  return "***" + accessToken.slice(-10);
}

// Get user email display name
export function getUserEmailDisplay(token: TokenWithUsage): string {
  return token.userEmail || "unknown";
}

// Update user info from usage limits
export function updateUserInfo(token: TokenWithUsage): void {
  if (token.accessToken) {
    token.tokenPreview = generateTokenPreview(token.accessToken);
  }

  if (token.usageLimits?.userInfo?.email) {
    token.userEmail = token.usageLimits.userInfo.email;
  }
}
