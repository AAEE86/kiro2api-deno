/**
 * CodeWhisperer API 客户端
 */

import type { CodeWhispererRequest } from "../types/codewhisperer.ts";
import { AWS_ENDPOINTS } from "../config/constants.ts";
import { createCodeWhispererHeaders } from "./request_headers.ts";
import * as logger from "../logger/logger.ts";

/**
 * 发送请求到 CodeWhisperer
 */
export async function sendCodeWhispererRequest(
  cwReq: CodeWhispererRequest,
  accessToken: string,
  requestId: string
): Promise<Response> {
  const reqStr = JSON.stringify(cwReq);
  
  logger.debug(
    "发送请求到 CodeWhisperer",
    logger.String("request_id", requestId),
    logger.String("direction", "upstream_request"),
    logger.Int("request_size", reqStr.length),
  );

  // 调试工具信息
  if (Deno.env.get("DEBUG_TOOLS") === "true") {
    logger.debug("完整请求", logger.Any("request", JSON.parse(reqStr)));
  }

  const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
    method: "POST",
    headers: createCodeWhispererHeaders(accessToken),
    body: reqStr,
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(
      "CodeWhisperer API 错误",
      logger.Int("status", response.status),
      logger.String("error", errorText),
    );
    throw new Error(`CodeWhisperer API error: ${response.status}`);
  }

  return response;
}
