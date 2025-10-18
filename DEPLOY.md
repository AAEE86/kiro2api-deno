# Deno Deploy 部署指南

## 修复的问题

原始的 `ISOLATE_INTERNAL_FAILURE` 错误已通过以下修改解决：

1. **移除不稳定 API**: 删除了 `--unstable-kv` 标志
2. **修复文件操作**: 替换 `Deno.stat` 为路径检查
3. **创建 Deploy 专用入口**: 使用 `deploy.ts` 而非 `main.ts`
4. **简化依赖**: 移除可能导致问题的库

## 部署步骤

### 1. 准备代码

确保使用 `deploy.ts` 作为入口文件：

```bash
# 检查 deno.json 配置
cat deno.json | grep exports
# 应该显示: "exports": "./deploy.ts"
```

### 2. 设置环境变量

在 Deno Deploy 控制台中设置以下环境变量：

```bash
KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"your_actual_token"}]'
KIRO_CLIENT_TOKEN=your-secure-password
LOG_LEVEL=info
LOG_FORMAT=json
```

### 3. 部署

使用以下任一方式部署：

**方式 1: GitHub 集成**
1. 推送代码到 GitHub
2. 在 Deno Deploy 中连接仓库
3. 设置入口文件为 `deploy.ts`

**方式 2: 直接上传**
1. 压缩项目文件
2. 在 Deno Deploy 中上传
3. 设置入口文件为 `deploy.ts`

## 测试部署

部署成功后，测试以下端点：

```bash
# 基础连通性
curl https://your-project.deno.dev/

# Token 池状态
curl https://your-project.deno.dev/api/tokens

# 模型列表（需要认证）
curl -H "Authorization: Bearer your-client-token" \
  https://your-project.deno.dev/v1/models

# API 测试
curl -X POST https://your-project.deno.dev/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-client-token" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

## 故障排除

### 常见问题

1. **环境变量未设置**
   - 检查 Deno Deploy 控制台中的环境变量配置
   - 确保 JSON 格式正确

2. **认证失败**
   - 验证 `KIRO_CLIENT_TOKEN` 设置正确
   - 检查请求头格式

3. **Token 刷新失败**
   - 验证 `KIRO_AUTH_TOKEN` 中的 refresh token 有效
   - 检查日志中的详细错误信息

### 查看日志

在 Deno Deploy 控制台中查看实时日志：
1. 进入项目页面
2. 点击 "Logs" 标签
3. 查看错误和调试信息

## 性能优化

1. **冷启动优化**: 已移除不必要的依赖
2. **内存使用**: 使用内存缓存而非持久化存储
3. **并发处理**: 支持多个并发请求

## 限制说明

- 不支持文件系统操作（配置必须通过环境变量）
- 内存缓存在实例重启时会丢失
- 单实例部署，无法跨实例共享状态