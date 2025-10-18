import { AuthService } from "./auth/auth_service.ts";
import {
  handleChatCompletions,
  handleMessages,
  handleModels,
  handleTokenStatus,
} from "./server/handlers.ts";
import { DEFAULTS } from "./config/constants.ts";

// Middleware to check authorization
function checkAuth(req: Request, clientToken: string): boolean {
  // Skip auth for non-v1 endpoints
  const url = new URL(req.url);
  if (!url.pathname.startsWith("/v1")) {
    return true;
  }

  const authHeader = req.headers.get("authorization");
  const apiKey = req.headers.get("x-api-key");

  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.substring(7) === clientToken;
  }

  if (apiKey) {
    return apiKey === clientToken;
  }

  return false;
}

// Main request handler
async function handleRequest(
  req: Request,
  authService: AuthService,
  clientToken: string,
): Promise<Response> {
  const url = new URL(req.url);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  };

  // Handle OPTIONS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Check authentication
  if (!checkAuth(req, clientToken)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Route handling
  try {
    let response: Response;

    if (url.pathname === "/v1/models" && req.method === "GET") {
      response = await handleModels();
    } else if (url.pathname === "/api/tokens" && req.method === "GET") {
      response = await handleTokenStatus(authService);
    } else if (url.pathname === "/v1/messages" && req.method === "POST") {
      response = await handleMessages(req, authService);
    } else if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      response = await handleChatCompletions(req, authService);
    } else if (url.pathname === "/" && req.method === "GET") {
      response = new Response("kiro2api Deno - AI API Gateway\n", {
        headers: { "Content-Type": "text/plain" },
      });
    } else {
      response = new Response("Not Found", { status: 404 });
    }

    // Add CORS headers to response
    const headers = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      headers.set(key, value);
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch (error) {
    console.error("Error handling request:", error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}

// Main function
async function main() {
  try {
    // Load environment variables from .env file if it exists
    try {
      const env = await Deno.readTextFile(".env");
      env.split("\n").forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
          const [, key, value] = match;
          Deno.env.set(key.trim(), value.trim());
        }
      });
      console.log("Loaded .env file");
    } catch {
      console.log("No .env file found, using environment variables");
    }

    // Get configuration
    const port = parseInt(Deno.env.get("PORT") || String(DEFAULTS.PORT));
    const clientToken = Deno.env.get("KIRO_CLIENT_TOKEN");

    if (!clientToken) {
      console.error("Error: KIRO_CLIENT_TOKEN environment variable not set");
      console.error("Please set KIRO_CLIENT_TOKEN in .env file or environment");
      Deno.exit(1);
    }

    // Create AuthService
    console.log("Initializing AuthService...");
    const authService = await AuthService.create();
    console.log("AuthService initialized successfully");

    // Start server
    console.log(`Starting server on port ${port}...`);

    Deno.serve({
      port,
      onListen: ({ hostname, port }) => {
        console.log(`\n🚀 kiro2api (Deno) listening on http://${hostname}:${port}`);
        console.log(`\nAvailable endpoints:`);
        console.log(`  GET  /                        - Welcome message`);
        console.log(`  GET  /api/tokens              - Token pool status`);
        console.log(`  GET  /v1/models               - List available models`);
        console.log(`  POST /v1/messages             - Anthropic API endpoint`);
        console.log(`  POST /v1/chat/completions     - OpenAI API endpoint`);
        console.log(`\nPress Ctrl+C to stop\n`);
      },
    }, (req) => handleRequest(req, authService, clientToken));
  } catch (error) {
    console.error("Fatal error:", error);
    Deno.exit(1);
  }
}

// Run the server
if (import.meta.main) {
  main();
}
