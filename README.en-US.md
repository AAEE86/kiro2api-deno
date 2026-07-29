

# Deprecated

Recommend using https://github.com/hank9999/kiro.rs

---
# kiro2api-deno

**High-Performance AI API Proxy Server - Deno Implementation**

This is the Deno/TypeScript implementation of kiro2api, providing the same functionality as the Go version but with cleaner code, faster startup times, and a better development experience.

[![Deno Version](https://img.shields.io/badge/deno-2.0+-blue.svg)](https://deno.land)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](../LICENSE)

## ✨ Features

### Core Features

- ✅ **Full API Compatibility**: Supports Anthropic and OpenAI API formats
- ✅ **Multi-Account Pool Management**: Sequential selection strategy with automatic failover
- ✅ **Dual Authentication Methods**: Supports Social and IdC authentication
- ✅ **Streaming Responses**: Zero-latency SSE real-time transmission
- ✅ **Image Support**: Image input in data URL format
- ✅ **Tool Calling**: Full tool use support
- ✅ **Token Counting**: Precise token usage statistics
- ✅ **Web Dashboard**: Real-time monitoring of token pool status
- ✅ **Token Management API**: Dynamically add/remove/import tokens

### Deno Advantages

- 🚀 **Fast Startup**: Millisecond-level startup time
- 🔒 **Secure by Default**: Permission model with explicitly declared required permissions
- 📦 **Single-File Deployment**: Can be compiled into a single executable
- 🎯 **Native TypeScript**: No compilation step required
- 🌐 **Standard Web APIs**: Uses modern web standards
- 🔄 **Hot Reload**: Automatic restart in development mode
- ✅ **Type Safety**: Full TypeScript type checking

## 📚 Quick Start

### Prerequisites

- [Deno 2.0+](https://deno.land/manual/getting_started/installation)

### Local Run

```bash
# 1. Navigate to the project directory
cd kiro2api-deno

# 2. Configure environment variables
cp .env.example .env
# Edit the .env file to set KIRO_AUTH_TOKEN and KIRO_CLIENT_TOKEN

# 3. Start the service
deno task start

# Or in development mode (with auto-reload)
deno task dev
```

### Docker Deployment

```bash
# Using docker-compose
docker-compose up -d

# Or using Docker directly
docker build -t kiro2api-deno .
docker run -d \
  --name kiro2api-deno \
  -p 8080:8080 \
  -e KIRO_AUTH_TOKEN='[{"auth":"Social","refreshToken":"your_token"}]' \
  -e KIRO_CLIENT_TOKEN="123456" \
  kiro2api-deno
```

### Compile to a Single Executable

```bash
# Compile
deno task compile

# Run the compiled file
./kiro2api
```

### Cloud Deployment (Deno Deploy)

**The easiest deployment method, no server needed!**

For detailed deployment guides, see [DEPLOY.md](./DEPLOY.md)

## 🎨 Web Dashboard

Visit `http://localhost:8080/` to see the real-time token pool monitoring dashboard:

- 🔐 **Token Status Overview**: Total count, available count, last update time
- 📊 **Detailed Information Table**: User email, token preview, auth method, remaining calls, expiration time, etc.
- 🔄 **Auto Refresh**: Optional 30-second auto-refresh feature
- 🎨 **Modern UI**: Gradient background, frosted glass effect, responsive design
- 🔧 **Token Management**: Dynamically add, remove, and import tokens (access `/admin`)

For detailed usage instructions, see [WEB_DASHBOARD.md](./WEB_DASHBOARD.md)

## 🔌 API Endpoints

### Supported Endpoints

| Endpoint                            | Method   | Description                           | Auth |
| ------------------------------- | ------ | ----------------------------- | ---- |
| `/`                             | GET    | Web Dashboard                  | ❌   |
| `/admin`                        | GET    | Token Management Dashboard                | ❌   |
| `/api/tokens`                   | GET    | Token Pool Status API              | ❌   |
| `/api/admin/tokens`             | GET    | Get All Tokens                | ✅   |
| `/api/admin/tokens`             | POST   | Add New Token                  | ✅   |
| `/api/admin/tokens`             | DELETE | Delete Token                    | ✅   |
| `/api/admin/tokens/import`      | POST   | Batch Import Tokens                | ✅   |
| `/api/admin/tokens/clear`       | POST   | Clear All Tokens                | ✅   |
| `/v1/models`                    | GET    | Get Available Models List              | ✅   |
| `/v1/messages`                  | POST   | Anthropic API Compatible Endpoint        | ✅   |
| `/v1/messages/count_tokens`     | POST   | Token Counting Endpoint                | ✅   |
| `/v1/chat/completions`          | POST   | OpenAI API Compatible Endpoint           | ✅   |

### Usage Examples

#### Anthropic API Format

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

#### OpenAI API Format

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

#### Streaming Request

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

#### Token Counting

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

## ⚙️ Configuration

### Environment Variables

#### Required Configuration

- `KIRO_AUTH_TOKEN`: AWS authentication configuration (JSON array or file path)
- `KIRO_CLIENT_TOKEN`: API authentication key

#### Optional Configuration

- `PORT`: Service port (default: 8080)
- `LOG_LEVEL`: Log level (default: info, options: debug, info, warn, error)
- `LOG_FORMAT`: Log format (default: json, options: json, text)
- `LOG_FILE`: Log file path (optional)
- `LOG_CONSOLE`: Console output toggle (default: true)

### Multi-Account Configuration Example

```bash
# Method 1: Direct JSON string configuration
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

# Method 2: Using a configuration file
export KIRO_AUTH_TOKEN=/path/to/config.json
# Or
export KIRO_AUTH_TOKEN=./config.json
```

Configuration file format (`config.json`):

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

## 🏗️ Project Structure

```
kiro2api-deno/
├── main.ts                     # Main entry file
├── deno.json                   # Deno configuration and task definitions
├── deno.lock                   # Dependency lock file
├── .env.example                # Environment variable example
├── config.json                 # Token configuration example
├── Dockerfile                  # Docker image configuration
├── docker-compose.yml          # Docker Compose configuration
├── README.md                   # This document
├── QUICKSTART.md               # Quick start guide
├── DEPLOY.md                   # Deployment guide
├── TESTING.md                  # Testing guide
├── WEB_DASHBOARD.md            # Web interface usage guide
├── static/                     # Static files (Web interface)
│   ├── index.html              # Main page
│   ├── admin.html              # Admin page
│   ├── css/
│   │   └── dashboard.css       # Stylesheet
│   └── js/
│       ├── dashboard.js        # Main page logic
│       └── admin.js            # Admin page logic
├── types/                      # TypeScript type definitions
│   ├── common.ts               # Common types
│   ├── anthropic.ts            # Anthropic API types
│   ├── openai.ts               # OpenAI API types
│   ├── codewhisperer.ts        # CodeWhisperer types
│   ├── token.ts                # Token types
│   └── usage_limits.ts         # Usage limits types
├── config/                     # Configuration and constants
│   ├── constants.ts            # Constant definitions
│   ├── cache.ts                # Cache configuration
│   ├── timeout.ts              # Timeout configuration
│   └── tuning.ts               # Tuning parameters
├── auth/                       # Authentication service
│   ├── config.ts               # Auth configuration
│   ├── refresh.ts              # Token refresh
│   ├── token_manager.ts        # Token manager
│   ├── auth_service.ts         # Auth service
│   ├── kv_store.ts             # KV store
│   └── usage_checker.ts        # Usage checker
├── converter/                  # Format converter
│   ├── converter.ts            # Main converter
│   ├── openai.ts               # OpenAI conversion
│   ├── content.ts              # Content conversion
│   └── tools.ts                # Tool conversion
├── parser/                     # Streaming parser
│   ├── compliant_event_stream_parser.ts
│   ├── enhanced_parser.ts
│   ├── robust_parser.ts
│   ├── sonic_streaming_aggregator.ts
│   └── ...
├── server/                     # HTTP server
│   ├── handlers.ts             # Request handlers
│   ├── middleware.ts           # Middleware
│   ├── openai_handlers.ts      # OpenAI handlers
│   ├── stream_processor.ts     # Stream processor
│   ├── count_tokens_handler.ts # Token counting handler
│   └── ...
├── routes/                     # Route handling
│   └── token_admin.ts          # Token admin routes
├── logger/                     # Logging system
│   ├── logger.ts               # Base logger implementation
│   ├── context.ts              # Request context management
│   ├── metrics.ts              # Performance metrics collection
│   ├── error_tracker.ts        # Error tracking and classification
│   ├── README.md               # Logging system usage guide
│   └── example.ts              # Usage example
├── utils/                      # Utility functions
│   ├── client.ts               # HTTP client
│   ├── env.ts                  # Environment variable handling
│   ├── token_estimator.ts      # Token estimation
│   └── ...
├── smoke_test.ts               # Smoke test
├── e2e_test.ts                 # End-to-end test
└── test.sh                     # Test script
```

## 🎯 Supported Models

| Model Name                     | CodeWhisperer Model ID             | Description           |
| ---------------------------- | --------------------------------- | -------------- |
| `claude-sonnet-4-5-20250929` | `CLAUDE_SONNET_4_5_20250929_V1_0` | Latest Sonnet 4.5 |
| `claude-sonnet-4-20250514`   | `CLAUDE_SONNET_4_20250514_V1_0`   | Sonnet 4       |
| `claude-3-7-sonnet-20250219` | `CLAUDE_3_7_SONNET_20250219_V1_0` | Sonnet 3.7     |
| `claude-3-5-haiku-20241022`  | `auto`                            | Haiku 3.5      |

## 📊 Performance Comparison

Compared to the Go version:

| Metric         | Go Version | Deno Version | Notes                     |
| ------------ | ------- | --------- | ------------------------ |
| Startup Time     | ~50ms   | ~10ms     | Deno starts faster            |
| Memory Usage     | ~20MB   | ~30MB     | Go is more memory efficient            |
| Binary Size   | ~15MB   | ~100MB*   | Includes full Deno runtime     |
| Hot Reload       | ❌      | ✅        | Deno supports hot reload in dev mode  |
| Type Safety     | ⚠️      | ✅        | Full TypeScript type checking  |
| Development Experience     | ⭐⭐⭐  | ⭐⭐⭐⭐⭐ | Deno offers a better dev experience        |
| Deployment Convenience   | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Deno Deploy one-click deployment     |

\* The compiled single-file executable includes the full Deno runtime.

## 🛠️ Development Guide

### Available Tasks

```bash
# Start service
deno task start

# Development mode (auto-reload)
deno task dev

# Run tests
deno task test

# Type check
deno task check

# Format code
deno task fmt

# Lint code
deno task lint

# Compile to executable
deno task compile
```

### Running Tests

```bash
# Run all tests
./test.sh

# Or run individually
deno task test           # Unit tests
deno run --allow-net --allow-env --allow-read smoke_test.ts  # Smoke test
deno run --allow-all e2e_test.ts  # End-to-end test
```

For detailed testing guides, see [TESTING.md](./TESTING.md)

## 🔧 Troubleshooting

### Common Issues

#### 1. Permission Errors

```bash
# Ensure sufficient permissions are granted
deno run --allow-net --allow-env --allow-read --allow-write --unstable-kv main.ts
```

#### 2. Token Authentication Failure

```bash
# Check KIRO_AUTH_TOKEN format
echo $KIRO_AUTH_TOKEN | jq .

# Or use Deno
deno eval 'console.log(Deno.env.get("KIRO_AUTH_TOKEN"))'
```

#### 3. Port Already in Use

```bash
# Change the port
PORT=8081 deno task start
```

#### 4. Configuration File Path Issues

```bash
# Use an absolute path
export KIRO_AUTH_TOKEN=/absolute/path/to/config.json

# Or a path relative to the project root
export KIRO_AUTH_TOKEN=./config.json
```

### Debug Mode

```bash
# Enable verbose logging
LOG_LEVEL=debug deno task start

# Use text format logs (more readable)
LOG_LEVEL=debug LOG_FORMAT=text deno task start

# Output to file
LOG_LEVEL=debug LOG_FILE=./logs/app.log deno task start
```

### Logging System Optimization

The project has comprehensively optimized the logging system to provide full observability support:

**Core Features**:
- ✅ **Full Error Stack**: Preserves complete Error object information (message, name, stack)
- ✅ **Request Tracing**: Unified requestId to track request lifecycle
- ✅ **Performance Metrics**: Automatically collects timing and performance data for each phase
- ✅ **Error Classification**: 15 predefined error types for structured tracking
- ✅ **New Fields**: HttpStatus, ErrorType, Latency, Bytes, Phase, etc.
- ✅ **Comprehensive Coverage**: 10+ critical modules integrated with detailed logging

**Covered Modules**:
- ✅ Token Refresh (auth/refresh.ts)
- ✅ Token Management (auth/token_manager.ts)
- ✅ Request Handling (server/handlers.ts)
- ✅ OpenAI Handling (server/openai_handlers.ts)
- ✅ Stream Processing (server/stream_processor.ts)
- ✅ Converter (converter/converter.ts)
- ✅ Upstream Client (utils/codewhisperer_client.ts)
- ✅ Token API (routes/token_admin.ts)

Detailed Documentation:
- [logger/README.md](./logger/README.md) - Complete usage guide
- [logger/QUICK_REFERENCE.md](./logger/QUICK_REFERENCE.md) - Quick reference
- [LOGGING_OPTIMIZATION.md](./LOGGING_OPTIMIZATION.md) - Phase 1 optimization
- [LOGGING_ENHANCEMENT.md](./LOGGING_ENHANCEMENT.md) - Phase 2 enhancement

#### Log Example

```json
{
  "timestamp": "2025-01-15T10:30:45.123Z",
  "level": "INFO",
  "message": "Request completed",
  "request_id": "abc-123",
  "success": true,
  "total_duration": "250ms",
  "phase_durations": {
    "parse_request": 5,
    "get_token": 10,
    "upstream_request": 200,
    "parse_response": 35
  }
}
```

#### Troubleshooting Commands

```bash
# Find all logs for a specific request
cat app.log | jq 'select(.request_id == "abc-123")'

# Count error types
cat app.log | jq 'select(.error_type) | .error_type' | sort | uniq -c

# Analyze performance bottlenecks
cat app.log | jq 'select(.phase_durations) | .phase_durations'

# Find requests taking longer than 1 second
cat app.log | jq 'select(.total_duration and (.total_duration | tonumber > 1000))'
```

## 🔗 Claude Code Integration

```bash
# Configure environment variables
export ANTHROPIC_BASE_URL="http://localhost:8080"
export ANTHROPIC_API_KEY="your-kiro-token"

# Use Claude Code
claude-code --model claude-sonnet-4 "帮我重构这段代码"
```

## 🆚 Differences from the Go Version

### Implementation Differences

- ✅ Uses Deno's native HTTP server instead of Gin
- ✅ Uses standard JSON parsing instead of sonic
- ✅ Simplified streaming parsing logic
- ✅ Uses Deno KV store instead of in-memory storage
- ✅ Removed complex concurrency control (handled automatically by Deno)

### Feature Completeness

- ✅ Core functionality fully compatible
- ✅ API endpoints fully compatible
- ✅ Web Dashboard (ported and enhanced from Go version)
- ✅ Token Management API (new feature)
- ✅ Comprehensive test coverage

### New Features

- 🆕 Dynamic Token Management API
- 🆕 Web Dashboard (`/admin`)
- 🆕 Configuration file support (in addition to environment variables)
- 🆕 More detailed logging system
- 🆕 Complete test suite

## 📖 Related Documentation

- [Quick Start Guide](./QUICKSTART.md) - 30-second quick start
- [Deployment Guide](./DEPLOY.md) - Detailed deployment instructions
- [Testing Guide](./TESTING.md) - Testing instructions and best practices
- [Web Dashboard Guide](./WEB_DASHBOARD.md) - Web dashboard usage instructions
- [Deno Official Documentation](https://deno.land/manual)
- [Main Project (Go Version)](https://github.com/caidaoli/kiro2api/blob/main/README.md)
- [Claude API Documentation](https://docs.anthropic.com/)
- [OpenAI API Documentation](https://platform.openai.com/docs/)

## 🤝 Contributing

Contributions are welcome! Please follow these steps:

1. Fork the project
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Create a Pull Request

### Development Guidelines

- Use `deno fmt` to format code
- Use `deno lint` to check code quality
- Use `deno task check` for type checking
- Add tests to cover new features
- Update related documentation

## 📄 License

Same as the main project

---

**Last Updated**: 2025-10-21

If you have any questions or suggestions, please submit an Issue on GitHub.
