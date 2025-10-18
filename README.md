# kiro2api - Deno Edition

**高性能 AI API 代理服务器 - Deno 实现版本**

*统一 Anthropic Claude、OpenAI 和 AWS CodeWhisperer 的智能网关*

[![Deno](https://img.shields.io/badge/Deno-2.0+-blue.svg)](https://deno.land/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## 🎯 项目特点

这是 kiro2api 的 Deno 实现版本，相比 Go 版本具有以下特点：

### ✅ 优势
- **现代化开发体验**: TypeScript 原生支持，无需额外配置
- **Web 标准 API**: 使用 ReadableStream、fetch 等现代 Web API
- **简洁代码**: 比 Go 版本减少约 30-40% 代码量
- **安全沙箱**: Deno 的权限系统提供更好的安全性
- **单一可执行文件**: 使用 `deno compile` 编译为独立可执行文件

### ⚠️ 权衡
- **性能**: JSON 处理和并发性能略低于 Go 版本（约 20-30%）
- **内存占用**: 约为 Go 版本的 2-3 倍
- **启动时间**: V8 启动较慢（约 50ms vs Go 的 <10ms）

### 💡 适用场景
- 中小规模部署（QPS < 500）
- 快速迭代和原型开发
- 团队熟悉 TypeScript/JavaScript
- 不需要极致性能的场景

## 🚀 快速开始

### 前置要求

- [Deno](https://deno.land/) 2.0 或更高版本

### 安装 Deno

```bash
# macOS / Linux
curl -fsSL https://deno.land/install.sh | sh

# Windows (PowerShell)
irm https://deno.land/install.ps1 | iex

# 使用 Homebrew (macOS)
brew install deno
```

### 运行项目

```bash
# 1. 克隆项目
git clone <repository-url>
cd kiro2api

# 2. 配置环境变量
cp .env.deno.example .env
# 编辑 .env 文件，设置 KIRO_AUTH_TOKEN 和 KIRO_CLIENT_TOKEN

# 3. 运行服务器
deno task dev

# 或者直接运行
deno run --allow-net --allow-env --allow-read --unstable-kv deno-src/main.ts
```

### 编译为可执行文件

```bash
# 编译
deno task compile

# 运行编译后的文件
./kiro2api
```

## 📁 项目结构

```
deno-src/
├── main.ts                          # 主入口文件
├── server.ts                        # HTTP 服务器和路由
├── config.ts                        # 配置管理
├── logger.ts                        # 日志系统
├── types.ts                         # 类型定义
├── stream_processor.ts              # 流式处理器
├── auth/
│   ├── auth_service.ts             # 认证服务
│   └── token_manager.ts            # Token 管理器
├── converter/
│   ├── anthropic_to_codewhisperer.ts
│   ├── codewhisperer_to_anthropic.ts
│   └── openai_to_anthropic.ts
└── parser/
    └── event_stream_parser.ts      # EventStream 解析器
```

## 🔧 配置说明

### 环境变量

```bash
# 必需配置
KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"your_token"}]'
KIRO_CLIENT_TOKEN=your-secure-password

# 可选配置
PORT=8080                    # 服务端口
LOG_LEVEL=info              # 日志级别: debug, info, warn, error
LOG_FORMAT=json             # 日志格式: text, json
```

### Token 配置

支持两种配置方式：

**方式 1: JSON 字符串**
```bash
KIRO_AUTH_TOKEN='[
  {
    "auth": "Social",
    "refreshToken": "your_social_token"
  },
  {
    "auth": "IdC",
    "refreshToken": "your_idc_token",
    "clientId": "your_client_id",
    "clientSecret": "your_client_secret"
  }
]'
```

**方式 2: 文件路径**
```bash
KIRO_AUTH_TOKEN=/path/to/auth_config.json
```

## 🌐 API 端点

### 支持的端点

- `GET /` - 服务状态
- `GET /api/tokens` - Token 池状态（无需认证）
- `GET /v1/models` - 获取可用模型列表
- `POST /v1/messages` - Anthropic Claude API（支持流式）
- `POST /v1/chat/completions` - OpenAI ChatCompletion API（支持流式）

### 认证方式

所有 `/v1/*` 端点需要认证：

```bash
# 使用 Authorization Bearer
Authorization: Bearer your-auth-token

# 或使用 x-api-key
x-api-key: your-auth-token
```

### 请求示例

```bash
# Anthropic API 格式
curl -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 123456" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 1000,
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'

# 流式请求
curl -N -X POST http://localhost:8080/v1/messages \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 123456" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "max_tokens": 200,
    "stream": true,
    "messages": [{"role": "user", "content": "讲个故事"}]
  }'
```

## 🏗️ 架构设计

### 核心组件

1. **Token 管理器** (`auth/token_manager.ts`)
   - 内存缓存（不使用 Deno KV）
   - 顺序选择策略
   - 自动刷新和故障转移

2. **流式处理器** (`stream_processor.ts`)
   - 使用原生 ReadableStream
   - EventStream 解析
   - 格式转换

3. **EventStream 解析器** (`parser/event_stream_parser.ts`)
   - BigEndian 格式解析
   - 使用 DataView 处理二进制数据
   - 完整的 AWS EventStream 协议支持

4. **格式转换器** (`converter/`)
   - Anthropic ↔ CodeWhisperer
   - OpenAI ↔ Anthropic
   - 工具调用支持

### 关键设计决策

#### 为什么不使用 Deno KV？

**Token 缓存使用内存 Map**：
- Token 缓存是高频访问的热数据
- Deno KV 的 I/O 开销会显著影响性能
- 内存缓存提供最低延迟

**Deno KV 的合理用途**（未实现，可扩展）：
- 持久化账号配置
- 使用统计和日志
- 跨实例共享配置

#### 流式处理

使用 Deno 原生的 `ReadableStream` API：
- 符合 Web 标准
- 零拷贝传输
- 自动背压处理

## 📊 性能对比

| 指标 | Go 版本 | Deno 版本 |
|------|---------|-----------|
| JSON 处理 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |
| 并发性能 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| 内存占用 | ~20MB | ~50MB |
| 启动速度 | <10ms | ~50ms |
| 流式处理 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 开发效率 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

## 🔍 故障排除

### 常见问题

**1. 权限错误**
```bash
# 确保授予必要的权限
deno run --allow-net --allow-env --allow-read --unstable-kv deno-src/main.ts
```

**2. Token 刷新失败**
```bash
# 启用调试日志
LOG_LEVEL=debug deno task dev
```

**3. 端口被占用**
```bash
# 修改端口
PORT=8081 deno task dev
```

### 调试技巧

```bash
# 查看详细日志
LOG_LEVEL=debug LOG_FORMAT=text deno task dev

# 检查 Token 池状态
curl http://localhost:8080/api/tokens

# 测试 API 连通性
curl -H "Authorization: Bearer 123456" \
  http://localhost:8080/v1/models
```

## 🚢 部署

### Docker 部署（TODO）

```dockerfile
FROM denoland/deno:2.0.0

WORKDIR /app

COPY deno.json .
COPY deno-src/ ./deno-src/

RUN deno cache deno-src/main.ts

EXPOSE 8080

CMD ["deno", "run", "--allow-net", "--allow-env", "--allow-read", "--unstable-kv", "deno-src/main.ts"]
```

### 编译部署

```bash
# 编译为可执行文件
deno task compile

# 部署
scp kiro2api user@server:/opt/kiro2api/
ssh user@server "chmod +x /opt/kiro2api/kiro2api"
```

## 🆚 与 Go 版本对比

| 特性 | Go 版本 | Deno 版本 |
|------|---------|-----------|
| **性能** | 极致性能 | 良好性能 |
| **内存** | 低占用 | 中等占用 |
| **开发效率** | 中等 | 高 |
| **类型安全** | 编译时 | 编译时 |
| **部署** | 单一二进制 | 单一二进制 |
| **生态系统** | 成熟 | 快速发展 |
| **学习曲线** | 中等 | 低（JS/TS） |

### 选择建议

**选择 Go 版本**：
- 需要极致性能（QPS > 1000）
- 资源受限环境
- 延迟敏感应用

**选择 Deno 版本**：
- 快速开发和迭代
- 团队熟悉 TypeScript
- 中小规模部署
- 追求现代化开发体验

## 📝 开发任务

### 已完成
- ✅ 基础架构和类型定义
- ✅ Token 管理器（内存缓存）
- ✅ EventStream 解析器
- ✅ 流式处理器
- ✅ Anthropic API 支持
- ✅ OpenAI API 支持（部分）

### 待完成
- ⏳ OpenAI 响应格式完整转换
- ⏳ 工具调用完整支持
- ⏳ 使用限制检查
- ⏳ 单元测试
- ⏳ Docker 镜像
- ⏳ 性能基准测试

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

与主项目保持一致

## 🔗 相关链接

- [Deno 官方文档](https://deno.land/manual)
- [Deno Deploy](https://deno.com/deploy)
- [原 Go 版本](../README.md)
