import type { AnthropicRequest } from "../types/anthropic.ts";
import * as logger from "../logger/logger.ts";

// Token计数请求
interface CountTokensRequest {
  model: string;
  system?: string | Array<{ type: string; text?: string; cache_control?: any }>;
  messages: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; tool_use_id?: string; content?: any }>;
  }>;
  tools?: Array<any>;
}

// Token计数响应
interface CountTokensResponse {
  input_tokens: number;
}

// 简单的token估算器
class TokenEstimator {
  // 估算文本token数量（约4个字符=1个token）
  estimateTextTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  // 估算消息内容token数量
  estimateMessageContent(content: any): number {
    if (typeof content === "string") {
      return this.estimateTextTokens(content);
    }

    if (Array.isArray(content)) {
      let total = 0;
      for (const item of content) {
        if (item.type === "text" && item.text) {
          total += this.estimateTextTokens(item.text);
        } else if (item.type === "tool_result") {
          total += 10; // 工具结果结构开销
          if (item.content) {
            if (typeof item.content === "string") {
              total += this.estimateTextTokens(item.content);
            } else if (Array.isArray(item.content)) {
              for (const c of item.content) {
                if (c.type === "text" && c.text) {
                  total += this.estimateTextTokens(c.text);
                }
              }
            }
          }
        }
      }
      return total;
    }

    return 0;
  }

  // 估算系统提示token数量
  estimateSystemTokens(system: any): number {
    if (!system) return 0;

    if (typeof system === "string") {
      return this.estimateTextTokens(system);
    }

    if (Array.isArray(system)) {
      let total = 0;
      for (const item of system) {
        if (item.type === "text" && item.text) {
          total += this.estimateTextTokens(item.text);
        }
      }
      return total;
    }

    return 0;
  }

  // 估算工具定义token数量
  estimateToolsTokens(tools: any[]): number {
    if (!tools || tools.length === 0) return 0;

    let total = 0;
    for (const tool of tools) {
      // 工具名称
      if (tool.name) {
        total += this.estimateTextTokens(tool.name);
      }
      // 工具描述
      if (tool.description) {
        total += this.estimateTextTokens(tool.description);
      }
      // 工具schema（简化估算）
      if (tool.input_schema) {
        const schemaStr = JSON.stringify(tool.input_schema);
        total += Math.ceil(schemaStr.length / 4);
      }
      // 结构开销
      total += 20;
    }
    return total;
  }

  // 估算总token数量
  estimateTokens(req: CountTokensRequest): number {
    let total = 0;

    // 系统提示
    total += this.estimateSystemTokens(req.system);

    // 消息
    for (const msg of req.messages) {
      total += 4; // 消息结构开销
      total += this.estimateMessageContent(msg.content);
    }

    // 工具定义
    total += this.estimateToolsTokens(req.tools || []);

    return total;
  }
}

// 验证Claude模型
function isValidClaudeModel(model: string): boolean {
  const validModels = [
    "claude-3-5-sonnet-20241022",
    "claude-3-5-sonnet-20240620",
    "claude-3-5-haiku-20241022",
    "claude-3-opus-20240229",
    "claude-3-sonnet-20240229",
    "claude-3-haiku-20240307",
  ];
  return validModels.includes(model);
}

// 处理token计数请求
export async function handleCountTokens(req: Request): Promise<Response> {
  try {
    const countReq: CountTokensRequest = await req.json();

    // 验证模型参数
    if (!isValidClaudeModel(countReq.model)) {
      logger.warn("无效的模型参数", logger.String("model", countReq.model));
      return Response.json({
        error: {
          type: "invalid_request_error",
          message: `Invalid model: ${countReq.model}`,
        },
      }, { status: 400 });
    }

    // 创建token估算器
    const estimator = new TokenEstimator();

    // 计算token数量
    const tokenCount = estimator.estimateTokens(countReq);

    // 返回符合官方API格式的响应
    const response: CountTokensResponse = {
      input_tokens: tokenCount,
    };

    return Response.json(response);
  } catch (error) {
    logger.error("token计数请求处理失败", logger.Err(error));
    return Response.json({
      error: {
        type: "invalid_request_error",
        message: `Invalid request body: ${(error as Error).message}`,
      },
    }, { status: 400 });
  }
}
