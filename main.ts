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

// Global variables for cloud deployment
let globalAuthService: AuthService | null = null;
let globalClientToken: string | null = null;

// Initialize function (called once on startup)
async function initialize() {
  // Load environment variables from .env file if it exists (local only)
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
    // .env file not found, using environment variables
  }

  // Get configuration
  globalClientToken = Deno.env.get("KIRO_CLIENT_TOKEN");

  if (!globalClientToken) {
    throw new Error(
      "KIRO_CLIENT_TOKEN environment variable not set. Please configure it in your deployment settings.",
    );
  }

  // Create AuthService
  console.log("Initializing AuthService...");
  globalAuthService = await AuthService.create();
  console.log("AuthService initialized successfully");
}

// Request handler wrapper with lazy initialization
async function handleRequestWithInit(req: Request): Promise<Response> {
  try {
    // Initialize on first request if not already done
    if (!globalAuthService || !globalClientToken) {
      await initialize();
    }

    return await handleRequest(req, globalAuthService!, globalClientToken!);
  } catch (error) {
    console.error("Request handling error:", error);
    return new Response(
      JSON.stringify({
        error: "Service initialization failed",
        message: error.message,
      }),
      {
        status: 503,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Check if running in Deno Deploy
const isDenoDeployment = Deno.env.get("DENO_DEPLOYMENT_ID") !== undefined;

// Main function for local development only
async function main() {
  if (isDenoDeployment) {
    console.log("Running in Deno Deploy, skipping local server setup");
    return;
  }

  const port = parseInt(Deno.env.get("PORT") || String(DEFAULTS.PORT));

  try {
    await initialize();

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
    }, handleRequestWithInit);
  } catch (error) {
    console.error("Fatal error:", error);
    throw error;
  }
}

// Export handler for Deno Deploy
export default { fetch: handleRequestWithInit };

// Run the server if executed directly and not in Deno Deploy
if (import.meta.main && !isDenoDeployment) {
  main().catch((error) => {
    console.error("Failed to start server:", error);
  });
}
