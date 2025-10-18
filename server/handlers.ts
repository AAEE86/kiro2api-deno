import type { AnthropicRequest } from "../types/anthropic.ts";
import type { OpenAIRequest } from "../types/openai.ts";
import type { TokenInfo } from "../types/common.ts";
import { AuthService } from "../auth/auth_service.ts";
import { anthropicToCodeWhisperer, generateId, openAIToAnthropic } from "../converter/converter.ts";
import { AWS_ENDPOINTS, MODEL_MAP } from "../config/constants.ts";

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
  const status = authService.getTokenPoolStatus();
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
      return await handleStreamRequest(anthropicReq, tokenInfo);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenInfo);
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
      return await handleStreamRequest(anthropicReq, tokenInfo);
    } else {
      return await handleNonStreamRequest(anthropicReq, tokenInfo);
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
): Promise<Response> {
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  // Create readable stream
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await fetch(`${AWS_ENDPOINTS.CODEWHISPERER}/`, {
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
        const decoder = new TextDecoder();

        // Send initial event
        const startEvent = {
          type: "message_start",
          message: {
            id: generateId("msg"),
            type: "message",
            role: "assistant",
            model: anthropicReq.model,
          },
        };
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(startEvent)}\n\n`),
        );

        // Process stream
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              // Parse SSE event
              if (line.startsWith("data:")) {
                const jsonStr = line.substring(5).trim();
                const event = JSON.parse(jsonStr);

                // Convert CodeWhisperer event to Anthropic format
                if (event.content) {
                  const deltaEvent = {
                    type: "content_block_delta",
                    index: 0,
                    delta: {
                      type: "text_delta",
                      text: event.content,
                    },
                  };
                  controller.enqueue(
                    new TextEncoder().encode(`data: ${JSON.stringify(deltaEvent)}\n\n`),
                  );
                }
              }
            } catch {
              // Skip invalid events
            }
          }
        }

        // Send final event
        const stopEvent = {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
        };
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(stopEvent)}\n\n`),
        );
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
): Promise<Response> {
  const conversationId = crypto.randomUUID();
  const cwReq = anthropicToCodeWhisperer(anthropicReq, conversationId);

  console.log("Sending request to CodeWhisperer:", JSON.stringify(cwReq, null, 2));

  const response = await fetch(`${AWS_ENDPOINTS.CODEWHISPERER}/`, {
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

  const cwResponse = await response.json();
  console.log("CodeWhisperer response:", JSON.stringify(cwResponse, null, 2));

  // Extract content from CodeWhisperer response
  let content = "";
  if (cwResponse.assistantResponseMessage?.content) {
    content = cwResponse.assistantResponseMessage.content;
  } else if (cwResponse.content) {
    content = cwResponse.content;
  } else if (cwResponse.message) {
    content = cwResponse.message;
  }

  // Convert response to Anthropic format
  const anthropicResponse = {
    id: generateId("msg"),
    type: "message",
    role: "assistant",
    model: anthropicReq.model,
    content: [
      {
        type: "text",
        text: content,
      },
    ],
    stop_reason: "end_turn",
    usage: {
      input_tokens: cwResponse.usage?.inputTokens || 0,
      output_tokens: cwResponse.usage?.outputTokens || 0,
    },
  };

  return Response.json(anthropicResponse);
}
