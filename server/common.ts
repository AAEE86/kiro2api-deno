import * as logger from "../logger/logger.ts";

/**
 * 标准化错误响应
 * @param message 错误消息
 * @param status HTTP状态码
 * @param code 错误码（可选）
 * @returns Response对象
 */
export function respondError(
  message: string,
  status = 500,
  code?: string,
): Response {
  const errorCode = code || getErrorType(status);
  return Response.json({
    error: {
      message,
      type: errorCode,
      code: errorCode,
    },
  }, { status });
}

/**
 * 根据状态码获取错误类型
 */
function getErrorType(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 429:
      return "rate_limited";
    default:
      return "internal_error";
  }
}

/**
 * 格式化错误响应（支持格式化字符串）
 */
export function respondErrorf(
  status: number,
  format: string,
  ...args: unknown[]
): Response {
  const message = formatString(format, ...args);
  return respondError(message, status);
}

/**
 * 简单的字符串格式化
 */
function formatString(format: string, ...args: unknown[]): string {
  return format.replace(/%s/g, () => String(args.shift() || ""));
}

// 日志字段辅助函数
export interface LogContext {
  requestId?: string;
  messageId?: string;
}

export function addLogFields(ctx: LogContext, ...fields: unknown[]): unknown[] {
  const result = [];
  if (ctx.requestId) {
    result.push(logger.String("request_id", ctx.requestId));
  }
  if (ctx.messageId) {
    result.push(logger.String("message_id", ctx.messageId));
  }
  result.push(...fields);
  return result;
}

// 提取相关请求头
export function extractRelevantHeaders(headers: Headers): Record<string, string> {
  const relevantHeaders: Record<string, string> = {};
  
  const headerKeys = [
    "Content-Type",
    "Authorization",
    "X-API-Key",
    "X-Request-ID",
    "X-Forwarded-For",
    "Accept",
    "Accept-Encoding",
  ];

  for (const key of headerKeys) {
    const value = headers.get(key);
    if (value) {
      // 对敏感信息进行脱敏处理
      if (key === "Authorization" && value.length > 20) {
        relevantHeaders[key] = value.substring(0, 10) + "***" + value.substring(value.length - 7);
      } else if (key === "X-API-Key" && value.length > 10) {
        relevantHeaders[key] = value.substring(0, 5) + "***" + value.substring(value.length - 3);
      } else {
        relevantHeaders[key] = value;
      }
    }
  }

  return relevantHeaders;
}

// 创建token预览
export function createTokenPreview(token: string): string {
  if (token.length <= 10) {
    return "*".repeat(token.length);
  }
  return "***" + token.substring(token.length - 10);
}

// 邮箱脱敏
export function maskEmail(email: string): string {
  if (!email) return "";

  const parts = email.split("@");
  if (parts.length !== 2) {
    return email;
  }

  const username = parts[0];
  const domain = parts[1];

  // 处理用户名部分
  let maskedUsername: string;
  if (username.length <= 4) {
    maskedUsername = "*".repeat(username.length);
  } else {
    const prefix = username.substring(0, 2);
    const suffix = username.substring(username.length - 2);
    const middleLen = username.length - 4;
    maskedUsername = prefix + "*".repeat(middleLen) + suffix;
  }

  // 处理域名部分
  const domainParts = domain.split(".");
  let maskedDomain: string;

  if (domainParts.length === 1) {
    maskedDomain = "*".repeat(domain.length);
  } else if (domainParts.length === 2) {
    maskedDomain = "*".repeat(domainParts[0].length) + "." + domainParts[1];
  } else {
    const maskedParts = domainParts.map((part, i) => {
      if (i < domainParts.length - 2) {
        return "*".repeat(part.length);
      }
      return part;
    });
    maskedDomain = maskedParts.join(".");
  }

  return maskedUsername + "@" + maskedDomain;
}
