import type { AuthConfig } from "./config.ts";
import type { RefreshResponse, TokenInfo } from "../types/common.ts";
import { AWS_ENDPOINTS } from "../config/constants.ts";
import * as logger from "../logger/logger.ts";

// Refresh Social authentication token
async function refreshSocialToken(config: AuthConfig): Promise<TokenInfo> {
  const response = await fetch(AWS_ENDPOINTS.SOCIAL_REFRESH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refreshToken: config.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Social token refresh failed: ${response.status} ${response.statusText}`);
  }

  const data: RefreshResponse = await response.json();

  return {
    accessToken: data.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: new Date(Date.now() + data.expiresIn * 1000),
    expiresIn: data.expiresIn,
    profileArn: data.profileArn,
  };
}

// Refresh IdC authentication token
async function refreshIdCToken(config: AuthConfig): Promise<TokenInfo> {
  if (!config.clientId || !config.clientSecret) {
    throw new Error("IdC authentication requires clientId and clientSecret");
  }

  const response = await fetch(AWS_ENDPOINTS.IDC_REFRESH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      grantType: "refresh_token",
      refreshToken: config.refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`IdC token refresh failed: ${response.status} ${response.statusText}`);
  }

  const data: RefreshResponse = await response.json();

  return {
    accessToken: data.accessToken,
    refreshToken: config.refreshToken,
    expiresAt: new Date(Date.now() + data.expiresIn * 1000),
    expiresIn: data.expiresIn,
  };
}

// Main token refresh function
export async function refreshToken(config: AuthConfig): Promise<TokenInfo> {
  try {
    if (config.auth === "Social") {
      return await refreshSocialToken(config);
    } else if (config.auth === "IdC") {
      return await refreshIdCToken(config);
    } else {
      throw new Error(`Unknown auth type: ${config.auth}`);
    }
  } catch (error) {
    logger.error("Token 刷新失败", logger.String("auth_type", config.auth), logger.Err(error));
    throw error;
  }
}
