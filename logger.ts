/**
 * 日志系统模块
 * 提供结构化日志功能
 */

import * as log from "@std/log";

// ============================================================================
// 日志级别类型
// ============================================================================

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";

// ============================================================================
// 日志字段类型
// ============================================================================

export interface LogFields {
  [key: string]: unknown;
}

// ============================================================================
// 日志配置
// ============================================================================

let currentLevel: LogLevel = "info";
let currentFormat: LogFormat = "json";

/**
 * 初始化日志系统
 */
export function initLogger(level: LogLevel = "info", format: LogFormat = "json") {
  currentLevel = level;
  currentFormat = format;

  const logLevel = levelToLogLevel(level);

  log.setup({
    handlers: {
      console: new log.ConsoleHandler(logLevel, {
        formatter: format === "json" ? jsonFormatter : textFormatter,
      }),
    },
    loggers: {
      default: {
        level: logLevel,
        handlers: ["console"],
      },
    },
  });
}

/**
 * 转换日志级别
 */
function levelToLogLevel(level: LogLevel): log.LogLevel {
  switch (level) {
    case "debug":
      return "DEBUG";
    case "info":
      return "INFO";
    case "warn":
      return "WARN";
    case "error":
      return "ERROR";
    default:
      return "INFO";
  }
}

/**
 * JSON 格式化器
 */
function jsonFormatter(logRecord: log.LogRecord): string {
  const obj: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level: logRecord.levelName,
    message: logRecord.msg,
  };

  // 添加额外字段
  if (logRecord.args && logRecord.args.length > 0) {
    for (const arg of logRecord.args) {
      if (typeof arg === "object" && arg !== null) {
        Object.assign(obj, arg);
      }
    }
  }

  return JSON.stringify(obj);
}

/**
 * 文本格式化器
 */
function textFormatter(logRecord: log.LogRecord): string {
  const timestamp = new Date().toISOString();
  const level = logRecord.levelName.padEnd(5);
  let message = `${timestamp} ${level} ${logRecord.msg}`;

  // 添加额外字段
  if (logRecord.args && logRecord.args.length > 0) {
    const fields: string[] = [];
    for (const arg of logRecord.args) {
      if (typeof arg === "object" && arg !== null) {
        for (const [key, value] of Object.entries(arg)) {
          fields.push(`${key}=${JSON.stringify(value)}`);
        }
      }
    }
    if (fields.length > 0) {
      message += ` ${fields.join(" ")}`;
    }
  }

  return message;
}

// ============================================================================
// 日志方法
// ============================================================================

/**
 * Debug 日志
 */
export function debug(message: string, fields?: LogFields) {
  if (shouldLog("debug")) {
    log.debug(message, fields);
  }
}

/**
 * Info 日志
 */
export function info(message: string, fields?: LogFields) {
  if (shouldLog("info")) {
    log.info(message, fields);
  }
}

/**
 * Warn 日志
 */
export function warn(message: string, fields?: LogFields) {
  if (shouldLog("warn")) {
    log.warn(message, fields);
  }
}

/**
 * Error 日志
 */
export function error(message: string, fields?: LogFields) {
  if (shouldLog("error")) {
    log.error(message, fields);
  }
}

/**
 * 判断是否应该记录日志
 */
function shouldLog(level: LogLevel): boolean {
  const levels: LogLevel[] = ["debug", "info", "warn", "error"];
  const currentIndex = levels.indexOf(currentLevel);
  const targetIndex = levels.indexOf(level);
  return targetIndex >= currentIndex;
}

// ============================================================================
// 辅助方法
// ============================================================================

/**
 * 创建带有请求 ID 的日志字段
 */
export function withRequestId(requestId: string, fields?: LogFields): LogFields {
  return {
    request_id: requestId,
    ...fields,
  };
}

/**
 * 创建带有错误信息的日志字段
 */
export function withError(err: Error, fields?: LogFields): LogFields {
  return {
    error: err.message,
    stack: err.stack,
    ...fields,
  };
}

/**
 * 创建带有持续时间的日志字段
 */
export function withDuration(startTime: number, fields?: LogFields): LogFields {
  const duration = Date.now() - startTime;
  return {
    duration_ms: duration,
    ...fields,
  };
}

/**
 * 创建带有 Token 使用信息的日志字段
 */
export function withTokenUsage(
  inputTokens: number,
  outputTokens: number,
  fields?: LogFields,
): LogFields {
  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens: inputTokens + outputTokens,
    ...fields,
  };
}
