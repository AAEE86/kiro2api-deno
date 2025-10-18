/**
 * kiro2api - Deno Edition
 * 部署入口文件
 */

import { loadConfig } from "./deno-src/config.ts";
import { initLogger, info, error } from "./deno-src/logger.ts";
import { createAuthService } from "./deno-src/auth/auth_service.ts";
import { startServer } from "./deno-src/server.ts";

async function main() {
  try {
    const config = await loadConfig();
    initLogger(config.logLevel, config.logFormat);
    
    info("kiro2api - Deno Edition 启动中...");
    
    const authService = await createAuthService(config.authConfigs);
    await startServer(config, authService);
  } catch (err) {
    error("启动失败", {
      error: err instanceof Error ? err.message : String(err)
    });
    Deno.exit(1);
  }
}

if (import.meta.main) {
  main();
}
