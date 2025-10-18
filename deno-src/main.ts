/**
 * kiro2api - Deno Edition
 * 高性能 AI API 代理服务器
 */

import { loadConfig } from "./config.ts";
import { initLogger, info, error } from "./logger.ts";
import { createAuthService } from "./auth/auth_service.ts";
import { startServer } from "./server.ts";

/**
 * 主函数
 */
async function main() {
  try {
    // 加载配置
    const config = await loadConfig();

    // 初始化日志系统
    initLogger(config.logLevel, config.logFormat);

    info("kiro2api - Deno Edition 启动中...");
    info("配置加载完成", {
      port: config.port,
      log_level: config.logLevel,
      log_format: config.logFormat,
      auth_configs: config.authConfigs.length,
    });

    // 创建认证服务
    const authService = await createAuthService(config.authConfigs);

    // 启动服务器
    await startServer(config, authService);
  } catch (err) {
    error("启动失败", {
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    Deno.exit(1);
  }
}

// 运行主函数
if (import.meta.main) {
  main();
}
