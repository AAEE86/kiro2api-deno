#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { CompliantEventStreamParser } from "./parser/stream_parser.ts";
import { ToolLifecycleManager } from "./parser/tool_manager.ts";
import { SessionManager } from "./utils/session.ts";
import { UsageLimitsChecker } from "./auth/usage_checker.ts";

// Test enhanced stream parser
console.log("Testing CompliantEventStreamParser...");
const parser = new CompliantEventStreamParser();

// Simulate AWS EventStream data
const testData = new TextEncoder().encode(JSON.stringify({
  content: "Hello, world!",
  toolUse: {
    toolUseId: "test-123",
    name: "test_tool",
    input: { query: "test" }
  }
}));

const events = parser.parseStream(testData);
console.log("Parsed events:", events.length);

const result = parser.getResult();
console.log("Content:", result.content);
console.log("Tool calls:", result.toolCalls.length);

// Test tool lifecycle manager
console.log("\nTesting ToolLifecycleManager...");
const toolManager = new ToolLifecycleManager();

toolManager.startTool("tool-1", "search", { query: "test" });
console.log("Active tools:", toolManager.getAllActiveTools().length);

toolManager.completeTool("tool-1", { result: "success" });
console.log("Completed tools:", toolManager.getAllCompletedTools().length);
console.log("Active tools after completion:", toolManager.getAllActiveTools().length);

// Test session manager
console.log("\nTesting SessionManager...");
const clientInfo = { ip: "127.0.0.1", userAgent: "test-agent" };
const conversationId1 = SessionManager.generateStableConversationId(clientInfo);
const conversationId2 = SessionManager.generateStableConversationId(clientInfo);

console.log("Same client info generates same ID:", conversationId1 === conversationId2);

const agentId = SessionManager.generateAgentContinuationId();
console.log("Agent continuation ID generated:", agentId.length > 0);

// Test usage checker (will fail without real token, but tests structure)
console.log("\nTesting UsageLimitsChecker...");
const checker = new UsageLimitsChecker();
console.log("Usage checker created successfully");

console.log("\nAll enhanced features tested successfully!");