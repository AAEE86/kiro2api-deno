# kiro2api - Deno Implementation

**高性能 AI API 代理服务器 - Deno 版本**

这是 kiro2api 的 Deno/TypeScript 实现，提供与 Go 版本相同的功能，但具有更简洁的代码和更快的启动时间。

## 特性

### 核心功能
- ✅ **完整 API 兼容**: 支持 Anthropic 和 OpenAI API 格式
- ✅ **多账号池管理**: 顺序选择策略，自动故障转移
- ✅ **双认证方式**: Social 和 IdC 认证
- ✅ **流式响应**: 零延迟 SSE 实时传输
- ✅ **图片支持**: data URL 格式的图片输入
- ✅ **工具调用**: 完整的 tool use 支持

### Deno 优势
- 🚀 **快速启动**: 毫秒级启动时间
- 🔒 **安全默认**: 权限模型，显式声明所需权限
- 📦 **单文件部署**: 可编译为单个可执行文件
- 🎯 **原生 TypeScript**: 无需编译步骤
- 🌐 **标准 Web APIs**: 使用现代 Web 标准

## 快速开始

### 前置要求
- Deno 2.0+ ([安装指南](https://deno.land/manual/getting_started/installation))

### 本地运行

```bash
# 1. 克隆项目
cd deno-impl

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，设置 KIRO_AUTH_TOKEN 和 KIRO_CLIENT_TOKEN

# 3. 运行服务
deno task start

# 或开发模式（带自动重载）
deno task dev
```

### Docker 部署

```bash
# 使用 docker-compose
docker-compose up -d

# 或直接使用 Docker
docker build -t kiro2api-deno .
docker run -d \
  --name kiro2api-deno \
  -p 8080:8080 \
  -e KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"your_token"}]' \
  -e KIRO_CLIENT_TOKEN="123456" \
  kiro2api-deno
```

### 编译为单个可执行文件

```bash
# 编译
deno task compile

# 运行编译后的文件
./kiro2api
```

### 云部署（Deno Deploy）

**最简单的部署方式，无需服务器！**

1. 访问 [dash.deno.com](https://dash.deno.com)
2. 连接 GitHub 仓库
3. 选择 `deno-impl/main.ts` 作为入口点
4. 配置环境变量：
   - `KIRO_CLIENT_TOKEN`
   - `KIRO_AUTH_TOKEN`
5. 自动部署完成！

详细部署指南请查看 [DEPLOY.md](./DEPLOY.md)

## API 接口

### 支持的端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/` | GET | 欢迎信息 |
| `/api/tokens` | GET | Token 池状态（无需认证） |
| `/v1/models` | GET | 获取可用模型列表 |
| `/v1/messages` | POST | Anthropic API 兼容接口 |
| `/v1/chat/completions` | POST | OpenAI API 兼容接口 |

### 使用示例

#### Anthropic API 格式

```bash
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
```

#### OpenAI API 格式

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 123456" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "你好"}
    ]
  }'
```

#### 流式请求

```bash
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

## 配置说明

### 环境变量

#### 必需配置
- `KIRO_AUTH_TOKEN`: AWS 认证配置（JSON 数组）
- `KIRO_CLIENT_TOKEN`: API 认证密钥

#### 可选配置
- `PORT`: 服务端口（默认：8080）
- `LOG_LEVEL`: 日志级别（默认：info）

### 多账号配置示例

```bash
# 混合认证配置
export KIRO_AUTH_TOKEN='[
  {
    "auth": "Social",
    "refreshToken": "arn:aws:sso:us-east-1:999999999999:token/refresh/xxx",
    "description": "个人账号"
  },
  {
    "auth": "IdC",
    "refreshToken": "arn:aws:identitycenter::us-east-1:999999999999:account/instance/xxx",
    "clientId": "https://oidc.us-east-1.amazonaws.com/clients/xxx",
    "clientSecret": "eyJraWQiOiJrZXktM.....",
    "description": "企业账号"
  }
]'
```

## Claude Code 集成

```bash
# 配置环境变量
export ANTHROPIC_BASE_URL="http://localhost:8080/v1"
export ANTHROPIC_API_KEY="your-kiro-token"

# 使用 Claude Code
claude-code --model claude-sonnet-4 "帮我重构这段代码"
```

## 项目结构

```
deno-impl/
├── main.ts                 # 主入口文件
├── deno.json              # Deno 配置
├── types/                 # TypeScript 类型定义
│   ├── common.ts
│   ├── anthropic.ts
│   ├── openai.ts
│   └── codewhisperer.ts
├── config/                # 配置和常量
│   └── constants.ts
├── auth/                  # 认证服务
│   ├── config.ts
│   ├── refresh.ts
│   ├── token_manager.ts
│   └── auth_service.ts
├── converter/             # 格式转换器
│   └── converter.ts
├── server/                # HTTP 服务器
│   └── handlers.ts
├── Dockerfile             # Docker 镜像
├── docker-compose.yml     # Docker Compose 配置
└── README.md             # 本文档
```

## 支持的模型

| 模型名称 | CodeWhisperer 模型 ID |
|---------|----------------------|
| `claude-sonnet-4-5-20250929` | `CLAUDE_SONNET_4_5_20250929_V1_0` |
| `claude-sonnet-4-20250514` | `CLAUDE_SONNET_4_20250514_V1_0` |
| `claude-3-7-sonnet-20250219` | `CLAUDE_3_7_SONNET_20250219_V1_0` |
| `claude-3-5-haiku-20241022` | `auto` |

## 性能对比

与 Go 版本相比：

| 指标 | Go 版本 | Deno 版本 |
|-----|--------|----------|
| 启动时间 | ~50ms | ~10ms |
| 内存占用 | ~20MB | ~30MB |
| 二进制大小 | ~15MB | ~100MB* |
| 热重载 | ❌ | ✅ |
| 类型安全 | ⚠️ | ✅ |

\* 编译后的单文件可执行文件包含完整的 Deno 运行时

## 开发指南

### 运行测试

```bash
deno task test
```

### 代码格式化

```bash
deno fmt
```

### 代码检查

```bash
deno lint
```

### 类型检查

```bash
deno check main.ts
```

## 故障排除

### 常见问题

#### 1. 权限错误
```bash
# 确保授予足够的权限
deno run --allow-net --allow-env --allow-read main.ts
```

#### 2. Token 认证失败
```bash
# 检查 KIRO_AUTH_TOKEN 格式
deno run --allow-env -e 'console.log(Deno.env.get("KIRO_AUTH_TOKEN"))'
```

#### 3. 端口被占用
```bash
# 更改端口
PORT=8081 deno task start
```

### 调试模式

```bash
# 启用详细日志
LOG_LEVEL=debug deno task start
```

## 与 Go 版本的区别

### 实现差异
- 使用 Deno 原生 HTTP 服务器代替 Gin
- 使用标准 JSON 解析代替 sonic
- 简化了流式解析逻辑
- 移除了复杂的并发控制（Deno 自动处理）

### 功能完整性
- ✅ 核心功能完全兼容
- ✅ API 接口完全兼容
- ⚠️ 部分高级特性简化实现
- ❌ 暂不支持静态文件服务（可轻松添加）

## 许可证

与主项目相同

## 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 项目
2. 创建特性分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 相关资源

- [Deno 官方文档](https://deno.land/manual)
- [主项目（Go 版本）](../README.md)
- [Claude API 文档](https://docs.anthropic.com/)
- [OpenAI API 文档](https://platform.openai.com/docs/)
