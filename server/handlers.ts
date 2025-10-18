import type { AnthropicRequest } from "../types/anthropic.ts";
import type { OpenAIRequest } from "../types/openai.ts";
import type { TokenInfo } from "../types/common.ts";
import { AuthService } from "../auth/auth_service.ts";
import { anthropicToCodeWhisperer, generateId, openAIToAnthropic } from "../converter/converter.ts";
import { AWS_ENDPOINTS, MODEL_MAP } from "../config/constants.ts";
import { CompliantEventStreamParser } from "../parser/stream_parser.ts";
import { ToolLifecycleManager } from "../parser/tool_manager.ts";
import { SessionManager } from "../utils/session.ts";

// Handle /v1/models endpoint
export async function handleModels(): Promise<Response> {
  const models = Object.keys(MODEL_MAP).map((id) => ({
    id,
    object: "model",
    created: 1234567890,
    owned_by: "anthropic",
    display_name: id,
    type: "text",
    max_tokens: 200000,
  }));

  return Response.json({
    object: "list",
    data: models,
  });
}

// Handle /api/tokens endpoint
export async function handleTokenStatus(authService: AuthService): Promise<Response> {
  const status = await authService.getDetailedTokenPoolStatus();
  return Response.json(status);
}

// Handle /v1/messages endpoint (Anthropic format)
export async function handleMessages(
  req: Request,
  authService: AuthService,
): Promise<Response> {
  try {
    const anthropicReq: AnthropicRequest = await req.json();

    // Validate request
    if (!anthropicReq.messages || anthropicReq.messages.length === 0) {
      return Response.json({ error: "messages array cannot be empty" }, { status: 400 });
    }

    // Get token
    const tokenInfo = await authService.getToken();

    if (anthropicReq.stream) {
      return await handleStreamRequest(anthropicReq, tokenInfo, req);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenInfo, req);
    }
  } catch (error) {
    console.error("Error handling messages:", error);
    return Response.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// Handle /v1/chat/completions endpoint (OpenAI format)
export async function handleChatCompletions(
  req: Request,
  authService: AuthService,
): Promise<Response> {
  try {
    const openaiReq: OpenAIRequest = await req.json();

    // Convert to Anthropic format
    const anthropicReq = openAIToAnthropic(openaiReq);

    // Get token
    const tokenInfo = await authService.getToken();

    if (anthropicReq.stream) {
      return await handleStreamRequest(anthropicReq, tokenInfo, req);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenInfo, req);
    }
  } catch (error) {
    console.error("Error handling chat completions:", error);
    return Response.json(
      { error: error.message || "Internal server error" },
      { status: 500 },
    );
  }
}

// Handle streaming requests
async function handleStreamRequest(
  anthropicReq: AnthropicRequest,
  tokenInfo: TokenInfo,
  req?: Request,
): Promise<Response> {
  const clientInfo = req ? SessionManager.extractClientInfo(req) : {};
  const conversationId = SessionManager.generateStableConversationId(clientInfo);
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);
  
  const parser = new CompliantEventStreamParser();
  const toolManager = new ToolLifecycleManager();

  // Create readable stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${tokenInfo.accessToken}`,
          },
          body: JSON.stringify(cwReq),
        });

        if (!response.ok || !response.body) {
          throw new Error(`CodeWhisperer API error: ${response.status}`);
        }

        const reader = response.body.getReader();
        const encoder = new TextEncoder();

        // Send initial events
        const startEvent = {
          type: "message_start",
          message: {
            id: generateId("msg"),
            type: "message",
            role: "assistant",
            model: anthropicReq.model,
          },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(startEvent)}\n\n`));

        const blockStartEvent = {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(blockStartEvent)}\n\n`));

        // Parse AWS EventStream using enhanced parser
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const events = parser.parseStream(value);
          
          for (const event of events) {
            if (event.type === "content" && event.data.content) {
              const deltaEvent = {
                type: "content_block_delta",
                index: 0,
                delta: { type: "text_delta", text: event.data.content },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaEvent)}\n\n`));
            } else if (event.type === "tool_use") {
              toolManager.startTool(event.data.toolUse.toolUseId, event.data.toolUse.name, event.data.toolUse.input);
              const toolEvent = {
                type: "content_block_start",
                index: 1,
                content_block: {
                  type: "tool_use",
                  id: event.data.toolUse.toolUseId,
                  name: event.data.toolUse.name,
                  input: event.data.toolUse.input,
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(toolEvent)}\n\n`));
            }
          }
        }

        // Send final events
        const blockStopEvent = { type: "content_block_stop", index: 0 };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(blockStopEvent)}\n\n`));

        const stopEvent = {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 0 },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(stopEvent)}\n\n`));

        const messageStopEvent = { type: "message_stop" };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(messageStopEvent)}\n\n`));

        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}

// Handle non-streaming requests
async function handleNonStreamRequest(
  anthropicReq: AnthropicRequest,
  tokenInfo: TokenInfo,
  req?: Request,
): Promise<Response> {
  const clientInfo = req ? SessionManager.extractClientInfo(req) : {};
  const conversationId = SessionManager.generateStableConversationId(clientInfo);
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);
  
  const parser = new CompliantEventStreamParser();

  console.log("Sending request to CodeWhisperer:", JSON.stringify(cwReq, null, 2));

  const response = await fetch(AWS_ENDPOINTS.CODEWHISPERER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${tokenInfo.accessToken}`,
    },
    body: JSON.stringify(cwReq),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`CodeWhisperer API error: ${response.status}`, errorText);
    throw new Error(`CodeWhisperer API error: ${response.status}`);
  }

  // Read response as binary (AWS EventStream format)
  const responseBuffer = await response.arrayBuffer();
  const data = new Uint8Array(responseBuffer);
  console.log("CodeWhisperer response size:", data.length);

  // Parse AWS EventStream using enhanced parser
  parser.parseStream(data);
  const result = parser.getResult();
  
  console.log("Extracted content:", result.content);
  console.log("Tool calls:", result.toolCalls);

  // Convert response to Anthropic format
  const content: any[] = [];
  
  if (result.content) {
    content.push({
      type: "text",
      text: result.content,
    });
  }
  
  for (const tool of result.toolCalls) {
    content.push({
      type: "tool_use",
      id: tool.id,
      name: tool.name,
      input: tool.input,
    });
  }
  
  const anthropicResponse = {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    model: anthropicReq.model,
    content,
    stop_reason: result.stopReason,
    usage: result.usage,
  };

  return Response.json(anthropicResponse);
}
