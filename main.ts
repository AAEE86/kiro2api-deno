/**
 * kiro2api - Deno Edition
 * 快速启动入口（项目根目录）
 */

// 重新导出 deno-src/main.ts
export * from "./deno-src/main.ts";

// 如果直接运行此文件，则导入并执行主函数
if (import.meta.main) {
  const { default: main } = await import("./deno-src/main.ts");
  if (main) {
    await main();
  }
}
