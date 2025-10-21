# kiro2api-deno

**高性能 AI API 代理服务器 - Deno 实现**

这是 kiro2api 的 Deno/TypeScript 实现版本，提供与 Go 版本相同的功能，但具有更简洁的代码、更快的启动时间和更好的开发体验。

[![Deno Version](https://img.shields.io/badge/deno-2.0+-blue.svg)](https://deno.land)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)

## ✨ 特性

### 核心功能

- ✅ **完整 API 兼容**: 支持 Anthropic 和 OpenAI API 格式
- ✅ **多账号池管理**: 顺序选择策略，自动故障转移
- ✅ **双认证方式**: Social 和 IdC 认证支持
- ✅ **流式响应**: 零延迟 SSE 实时传输
- ✅ **图片支持**: data URL 格式的图片输入
- ✅ **工具调用**: 完整的 tool use 支持
- ✅ **Token 计数**: 精确的 token 使用量统计
- ✅ **Web 管理界面**: 实时监控 Token 池状态
- ✅ **Token 管理 API**: 动态添加/删除/导入 Token

### Deno 优势

- 🚀 **快速启动**: 毫秒级启动时间
- 🔒 **安全默认**: 权限模型，显式声明所需权限
- 📦 **单文件部署**: 可编译为单个可执行文件
- 🎯 **原生 TypeScript**: 无需编译步骤
- 🌐 **标准 Web APIs**: 使用现代 Web 标准
- 🔄 **热重载**: 开发模式自动重启
- ✅ **类型安全**: 完整的 TypeScript 类型检查

## 📚 快速开始

### 前置要求

- [Deno 2.0+](https://deno.land/manual/getting_started/installation)

### 本地运行

```bash
# 1. 进入项目目录
cd kiro2api-deno

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

详细部署指南请查看 [DEPLOY.md](./DEPLOY.md)

## 🎨 Web 管理界面

访问 `http://localhost:8080/` 可以看到实时的 Token 池监控面板：

- 🔐 **Token 状态概览**: 总数、可用数、最后更新时间
- 📊 **详细信息表格**: 用户邮箱、Token 预览、认证方式、剩余次数、过期时间等
- 🔄 **自动刷新**: 可选的 30 秒自动刷新功能
- 🎨 **现代化 UI**: 渐变背景、毛玻璃效果、响应式设计
- 🔧 **Token 管理**: 动态添加、删除、导入 Token（访问 `/admin`）

详细使用指南请查看 [WEB_DASHBOARD.md](./WEB_DASHBOARD.md)

## 🔌 API 接口

### 支持的端点

| 端点                            | 方法   | 描述                          | 认证 |
| ------------------------------- | ------ | ----------------------------- | ---- |
| `/`                             | GET    | Web 管理界面                  | ❌   |
| `/admin`                        | GET    | Token 管理界面                | ❌   |
| `/api/tokens`                   | GET    | Token 池状态 API              | ❌   |
| `/api/admin/tokens`             | GET    | 获取所有 Token                | ✅   |
| `/api/admin/tokens`             | POST   | 添加新 Token                  | ✅   |
| `/api/admin/tokens`             | DELETE | 删除 Token                    | ✅   |
| `/api/admin/tokens/import`      | POST   | 批量导入 Token                | ✅   |
| `/api/admin/tokens/clear`       | POST   | 清空所有 Token                | ✅   |
| `/v1/models`                    | GET    | 获取可用模型列表              | ✅   |
| `/v1/messages`                  | POST   | Anthropic API 兼容接口        | ✅   |
| `/v1/messages/count_tokens`     | POST   | Token 计数接口                | ✅   |
| `/v1/chat/completions`          | POST   | OpenAI API 兼容接口           | ✅   |

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

#### Token 计数

```bash
curl -X POST http://localhost:8080/v1/messages/count_tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 123456" \
  -d '{
    "model": "claude-sonnet-4-20250514",
    "messages": [
      {"role": "user", "content": "你好，世界！"}
    ]
  }'
```

## ⚙️ 配置说明

### 环境变量

#### 必需配置

- `KIRO_AUTH_TOKEN`: AWS 认证配置（JSON 数组或文件路径）
- `KIRO_CLIENT_TOKEN`: API 认证密钥

#### 可选配置

- `PORT`: 服务端口（默认：8080）
- `LOG_LEVEL`: 日志级别（默认：info，可选：debug, info, warn, error）
- `LOG_FORMAT`: 日志格式（默认：json，可选：json, text）
- `LOG_FILE`: 日志文件路径（可选）
- `LOG_CONSOLE`: 控制台输出开关（默认：true）

### 多账号配置示例

```bash
# 方式 1: 直接配置 JSON 字符串
export KIRO_AUTH_TOKEN='[
  {
    "auth": "Social",
    "refreshToken": "arn:aws:sso:us-east-1:999999999999:token/refresh/xxx"
  },
  {
    "auth": "IdC",
    "refreshToken": "aorAAAAAGj....",
    "clientId": "lQXHeKVw6ARTTbOfI9AiAXVzLWVhc3QtMQ",
    "clientSecret": "eyJraWQiOiJrZXktM....."
  }
]'

# 方式 2: 使用配置文件
export KIRO_AUTH_TOKEN=/path/to/config.json
# 或
export KIRO_AUTH_TOKEN=./config.json
```

配置文件格式（`config.json`）：

```json
[
  {
    "auth": "Social",
    "refreshToken": "your_social_refresh_token_here"
  },
  {
    "auth": "IdC",
    "refreshToken": "your_idc_refresh_token_here",
    "clientId": "your_idc_client_id",
    "clientSecret": "your_idc_client_secret"
  }
]
```

## 🏗️ 项目结构

```
kiro2api-deno/
├── main.ts                     # 主入口文件
├── deno.json                   # Deno 配置和任务定义
├── deno.lock                   # 依赖锁定文件
├── .env.example                # 环境变量示例
├── config.json                 # Token 配置示例
├── Dockerfile                  # Docker 镜像配置
├── docker-compose.yml          # Docker Compose 配置
├── README.md                   # 本文档
├── QUICKSTART.md               # 快速开始指南
├── DEPLOY.md                   # 部署指南
├── TESTING.md                  # 测试指南
├── WEB_DASHBOARD.md            # Web 界面使用指南
├── static/                     # 静态文件（Web 界面）
│   ├── index.html              # 主页面
│   ├── admin.html              # 管理页面
│   ├── css/
│   │   └── dashboard.css       # 样式表
│   └── js/
│       ├── dashboard.js        # 主页面逻辑
│       └── admin.js            # 管理页面逻辑
├── types/                      # TypeScript 类型定义
│   ├── common.ts               # 通用类型
│   ├── anthropic.ts            # Anthropic API 类型
│   ├── openai.ts               # OpenAI API 类型
│   ├── codewhisperer.ts        # CodeWhisperer 类型
│   ├── token.ts                # Token 类型
│   └── usage_limits.ts         # 使用限制类型
├── config/                     # 配置和常量
│   ├── constants.ts            # 常量定义
│   ├── cache.ts                # 缓存配置
│   ├── timeout.ts              # 超时配置
│   └── tuning.ts               # 调优参数
├── auth/                       # 认证服务
│   ├── config.ts               # 认证配置
│   ├── refresh.ts              # Token 刷新
│   ├── token_manager.ts        # Token 管理器
│   ├── auth_service.ts         # 认证服务
│   ├── kv_store.ts             # KV 存储
│   └── usage_checker.ts        # 使用量检查
├── converter/                  # 格式转换器
│   ├── converter.ts            # 主转换器
│   ├── openai.ts               # OpenAI 转换
│   ├── content.ts              # 内容转换
│   └── tools.ts                # 工具转换
├── parser/                     # 流式解析器
│   ├── compliant_event_stream_parser.ts
│   ├── enhanced_parser.ts
│   ├── robust_parser.ts
│   ├── sonic_streaming_aggregator.ts
│   └── ...
├── server/                     # HTTP 服务器
│   ├── handlers.ts             # 请求处理器
│   ├── middleware.ts           # 中间件
│   ├── openai_handlers.ts      # OpenAI 处理器
│   ├── stream_processor.ts     # 流处理器
│   ├── count_tokens_handler.ts # Token 计数处理器
│   └── ...
├── routes/                     # 路由处理
│   └── token_admin.ts          # Token 管理路由
├── logger/                     # 日志系统
│   └── logger.ts               # 日志实现
├── utils/                      # 工具函数
│   ├── client.ts               # HTTP 客户端
│   ├── env.ts                  # 环境变量处理
│   ├── token_estimator.ts      # Token 估算
│   └── ...
├── smoke_test.ts               # 冒烟测试
├── e2e_test.ts                 # 端到端测试
└── test.sh                     # 测试脚本
```

## 🎯 支持的模型

| 模型名称                     | CodeWhisperer 模型 ID             | 说明           |
| ---------------------------- | --------------------------------- | -------------- |
| `claude-sonnet-4-5-20250929` | `CLAUDE_SONNET_4_5_20250929_V1_0` | 最新 Sonnet 4.5 |
| `claude-sonnet-4-20250514`   | `CLAUDE_SONNET_4_20250514_V1_0`   | Sonnet 4       |
| `claude-3-7-sonnet-20250219` | `CLAUDE_3_7_SONNET_20250219_V1_0` | Sonnet 3.7     |
| `claude-3-5-haiku-20241022`  | `auto`                            | Haiku 3.5      |

## 📊 性能对比

与 Go 版本相比：

| 指标         | Go 版本 | Deno 版本 | 说明                     |
| ------------ | ------- | --------- | ------------------------ |
| 启动时间     | ~50ms   | ~10ms     | Deno 启动更快            |
| 内存占用     | ~20MB   | ~30MB     | Go 更节省内存            |
| 二进制大小   | ~15MB   | ~100MB*   | 包含完整 Deno 运行时     |
| 热重载       | ❌      | ✅        | Deno 支持开发模式热重载  |
| 类型安全     | ⚠️      | ✅        | TypeScript 完整类型检查  |
| 开发体验     | ⭐⭐⭐  | ⭐⭐⭐⭐⭐ | Deno 开发体验更好        |
| 部署便利性   | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Deno Deploy 一键部署     |

\* 编译后的单文件可执行文件包含完整的 Deno 运行时

## 🛠️ 开发指南

### 可用任务

```bash
# 启动服务
deno task start

# 开发模式（自动重载）
deno task dev

# 运行测试
deno task test

# 类型检查
deno task check

# 代码格式化
deno task fmt

# 代码检查
deno task lint

# 编译为可执行文件
deno task compile
```

### 运行测试

```bash
# 运行所有测试
./test.sh

# 或单独运行
deno task test           # 单元测试
deno run --allow-net --allow-env --allow-read smoke_test.ts  # 冒烟测试
deno run --allow-all e2e_test.ts  # 端到端测试
```

详细测试指南请查看 [TESTING.md](./TESTING.md)

## 🔧 故障排除

### 常见问题

#### 1. 权限错误

```bash
# 确保授予足够的权限
deno run --allow-net --allow-env --allow-read --allow-write --unstable-kv main.ts
```

#### 2. Token 认证失败

```bash
# 检查 KIRO_AUTH_TOKEN 格式
echo $KIRO_AUTH_TOKEN | jq .

# 或使用 Deno
deno eval 'console.log(Deno.env.get("KIRO_AUTH_TOKEN"))'
```

#### 3. 端口被占用

```bash
# 更改端口
PORT=8081 deno task start
```

#### 4. 配置文件路径问题

```bash
# 使用绝对路径
export KIRO_AUTH_TOKEN=/absolute/path/to/config.json

# 或相对于项目根目录的路径
export KIRO_AUTH_TOKEN=./config.json
```

### 调试模式

```bash
# 启用详细日志
LOG_LEVEL=debug deno task start

# 使用文本格式日志（更易读）
LOG_LEVEL=debug LOG_FORMAT=text deno task start
```

## 🔗 Claude Code 集成

```bash
# 配置环境变量
export ANTHROPIC_BASE_URL="http://localhost:8080"
export ANTHROPIC_API_KEY="your-kiro-token"

# 使用 Claude Code
claude-code --model claude-sonnet-4 "帮我重构这段代码"
```

## 🆚 与 Go 版本的区别

### 实现差异

- ✅ 使用 Deno 原生 HTTP 服务器代替 Gin
- ✅ 使用标准 JSON 解析代替 sonic
- ✅ 简化了流式解析逻辑
- ✅ 使用 Deno KV 存储代替内存存储
- ✅ 移除了复杂的并发控制（Deno 自动处理）

### 功能完整性

- ✅ 核心功能完全兼容
- ✅ API 接口完全兼容
- ✅ Web 管理界面（从 Go 版本移植并增强）
- ✅ Token 管理 API（新增功能）
- ✅ 完整的测试覆盖

### 新增功能

- 🆕 Token 动态管理 API
- 🆕 Web 管理界面（`/admin`）
- 🆕 配置文件支持（除了环境变量）
- 🆕 更详细的日志系统
- 🆕 完整的测试套件

## 📖 相关文档

- [快速开始指南](./QUICKSTART.md) - 30 秒快速启动
- [部署指南](./DEPLOY.md) - 详细的部署说明
- [测试指南](./TESTING.md) - 测试说明和最佳实践
- [Web 界面指南](./WEB_DASHBOARD.md) - Web 管理界面使用说明
- [Deno 官方文档](https://deno.land/manual)
- [主项目（Go 版本）](https://github.com/caidaoli/kiro2api/blob/main/README.md)
- [Claude API 文档](https://docs.anthropic.com/)
- [OpenAI API 文档](https://platform.openai.com/docs/)

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 项目
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 开发规范

- 使用 `deno fmt` 格式化代码
- 使用 `deno lint` 检查代码质量
- 使用 `deno task check` 进行类型检查
- 添加测试覆盖新功能
- 更新相关文档

## 📄 许可证

与主项目相同

---

**最后更新**: 2025-10-21

如有问题或建议，请在 GitHub 上提交 Issue。
