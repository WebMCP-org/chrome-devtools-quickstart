#!/usr/bin/env node

/**
 * Multi-Step Benchmark: Screenshots vs WebMCP Tools (Agent SDK Version)
 *
 * A realistic benchmark comparing token consumption between screenshot-based
 * and WebMCP tool-based browser automation for complex, multi-step tasks.
 *
 * **Key differences from deprecated version**:
 * - Uses Claude Agent SDK for realistic agentic behavior
 * - Agent naturally decides how to solve the task (not scripted)
 * - Runs each approach 3 times and averages results
 * - Same MCP server for both, difference is tool availability
 *
 * **Task**: Create a calendar event on a complex calendar app with WebMCP tools.
 *
 * **Approaches compared**:
 * 1. **Screenshot-based**: WebMCP tools blocked, must use screenshots/snapshots
 * 2. **WebMCP tool-based**: Can use list_webmcp_tools and call_webmcp_tool
 *
 * @example
 * ```bash
 * # Run the benchmark (uses live deployment by default)
 * npm run benchmark:complex
 * ```
 *
 * @requires ANTHROPIC_API_KEY - In .env file or environment variable
 * @requires Chrome browser - For browser automation
 *
 * @module benchmark/multi-step-benchmark
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
  cli,
  aggregateBenchmarkResults,
  printAgentApproachResults,
  printAgentComparisonResults,
  printAgentCostAnalysis,
  calculateImageTokensFromBase64,
  ImageMimeType,
} from "./helpers.js";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", ".env") });

// ============================================================
// Configuration
// ============================================================

const NUM_RUNS = 3;
const DEFAULT_CALENDAR_URL = "https://big-calendar.alexmnahas.workers.dev";
const CALENDAR_URL = process.env.DEV_SERVER_URL ?? DEFAULT_CALENDAR_URL;

const TASK = `Navigate to ${CALENDAR_URL}, explore the calendar application, and create a new event with the following details:
- Title: "Team Standup"
- Date: Tomorrow
- Time: 10:00 AM
- Duration: 30 minutes
- Description: "Daily sync meeting"

After creating the event, verify it appears on the calendar.`;

const MCP_SERVER_CONFIG = {
  "chrome-devtools": {
    command: "npx",
    args: ["-y", "@mcp-b/chrome-devtools-mcp@latest"],
  },
};

const SCREENSHOT_SYSTEM_PROMPT = `You are a browser automation agent.

IMPORTANT: You MUST use take_screenshot to visually inspect the page. Do NOT rely solely on take_snapshot (DOM snapshots). Take actual screenshots to see what's on screen, analyze the visual layout, and verify your actions.

For complex multi-step tasks like creating calendar events:
1. Navigate to the page
2. Take a SCREENSHOT to see the current calendar state
3. Analyze the screenshot to understand the UI layout
4. Use take_snapshot to find element UIDs for clicking/filling
5. Click buttons and fill forms step by step
6. Take a SCREENSHOT after each major action to verify
7. Take a final SCREENSHOT to confirm the event was created

Always take screenshots before and after important actions.`;

const WEBMCP_SYSTEM_PROMPT = `You are a browser automation agent. The page you're testing has WebMCP tools available that expose semantic APIs for the application's functionality.

IMPORTANT: Prioritize using WebMCP tools (via list_webmcp_tools and call_webmcp_tool) over taking screenshots. Only use screenshots if WebMCP tools are unavailable or you need visual verification. WebMCP tools provide direct programmatic access to the application's state and actions.

For calendar applications, look for tools like:
- get_calendar_state - to see current events
- get_users - to see available users
- get_event_colors - to see color options
- create_event - to create new events
- get_events - to verify creation`;

// ============================================================
// Types
// ============================================================

interface ToolUsage {
  [toolName: string]: number;
}

interface BenchmarkResult {
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  imageTokens: number;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  toolUsage: ToolUsage;
}

interface BenchmarkOptions {
  task: string;
  systemPrompt: string;
  mcpServers: Record<string, { command: string; args: string[] }>;
  disallowedTools?: string[];
}

// ============================================================
// Benchmark Runner
// ============================================================

async function runAgentBenchmark(options: BenchmarkOptions): Promise<BenchmarkResult> {
  const toolUsage: ToolUsage = {};
  let imageTokens = 0;

  const q = query({
    prompt: options.task,
    options: {
      systemPrompt: options.systemPrompt,
      mcpServers: options.mcpServers,
      disallowedTools: options.disallowedTools,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  });

  let resultMessage: SDKMessage | null = null;
  for await (const message of q) {
    if (message.type === "assistant") {
      for (const block of message.message.content) {
        if (block.type === "tool_use") {
          const toolName = block.name;
          toolUsage[toolName] = (toolUsage[toolName] || 0) + 1;
        }
      }
    }

    if (message.type === "user" && "tool_use_result" in message && message.tool_use_result) {
      const result = message.tool_use_result as {
        content?: Array<{ type: string; data?: string; mimeType?: string }>;
      };
      if (result.content) {
        for (const item of result.content) {
          if (item.type === "image" && item.data && item.mimeType) {
            const tokens = calculateImageTokensFromBase64(
              item.data,
              item.mimeType as ImageMimeType
            );
            if (tokens) imageTokens += tokens;
          }
        }
      }
    }

    if (message.type === "result") {
      resultMessage = message;
    }
  }

  if (!resultMessage || resultMessage.type !== "result") {
    return {
      success: false,
      inputTokens: 0,
      outputTokens: 0,
      imageTokens: 0,
      totalCostUsd: 0,
      durationMs: 0,
      numTurns: 0,
      toolUsage,
    };
  }

  return {
    success: resultMessage.subtype === "success",
    inputTokens: resultMessage.usage.input_tokens ?? 0,
    outputTokens: resultMessage.usage.output_tokens ?? 0,
    imageTokens,
    totalCostUsd: resultMessage.total_cost_usd ?? 0,
    durationMs: resultMessage.duration_ms ?? 0,
    numTurns: resultMessage.num_turns ?? 0,
    toolUsage,
  };
}

// ============================================================
// Benchmark Functions
// ============================================================

async function runScreenshotBenchmark(): Promise<BenchmarkResult> {
  return runAgentBenchmark({
    task: TASK,
    systemPrompt: SCREENSHOT_SYSTEM_PROMPT,
    mcpServers: MCP_SERVER_CONFIG,
    disallowedTools: [
      "mcp__chrome-devtools__list_webmcp_tools",
      "mcp__chrome-devtools__call_webmcp_tool",
    ],
  });
}

async function runWebMCPBenchmark(): Promise<BenchmarkResult> {
  return runAgentBenchmark({
    task: TASK,
    systemPrompt: WEBMCP_SYSTEM_PROMPT,
    mcpServers: MCP_SERVER_CONFIG,
  });
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  cli.header("Multi-Step Benchmark: Screenshots vs WebMCP Tools\nAgent SDK Version");

  cli.info(`Calendar URL: ${CALENDAR_URL}`);
  cli.info(`Runs per approach: ${NUM_RUNS}`);
  cli.info("Using Claude Agent SDK for realistic agentic behavior");
  cli.info("Screenshot approach: WebMCP tools blocked");
  cli.info("WebMCP approach: All tools available, prefers semantic tools");

  const screenshotResults: BenchmarkResult[] = [];
  const webmcpResults: BenchmarkResult[] = [];

  for (let i = 0; i < NUM_RUNS; i++) {
    cli.section(`RUN ${i + 1}/${NUM_RUNS}`);

    cli.info("Running Screenshot approach...");
    const screenshotResult = await runScreenshotBenchmark();
    screenshotResults.push(screenshotResult);
    if (screenshotResult.success) {
      cli.success(
        `Completed: ${screenshotResult.inputTokens.toLocaleString()} in / ${screenshotResult.outputTokens.toLocaleString()} out, $${screenshotResult.totalCostUsd.toFixed(4)}`
      );
    } else {
      cli.error("Failed");
    }

    cli.info("Running WebMCP approach...");
    const webmcpResult = await runWebMCPBenchmark();
    webmcpResults.push(webmcpResult);
    if (webmcpResult.success) {
      cli.success(
        `Completed: ${webmcpResult.inputTokens.toLocaleString()} in / ${webmcpResult.outputTokens.toLocaleString()} out, $${webmcpResult.totalCostUsd.toFixed(4)}`
      );
    } else {
      cli.error("Failed");
    }
  }

  const screenshotAgg = aggregateBenchmarkResults("Screenshot", screenshotResults);
  const webmcpAgg = aggregateBenchmarkResults("WebMCP", webmcpResults);

  cli.section("SCREENSHOT APPROACH RESULTS");
  printAgentApproachResults(screenshotAgg);

  cli.section("WEBMCP APPROACH RESULTS");
  printAgentApproachResults(webmcpAgg);

  printAgentComparisonResults(screenshotAgg, webmcpAgg, "FINAL COMPARISON");
  printAgentCostAnalysis(screenshotAgg, webmcpAgg);

  cli.success("Benchmark complete");
}

main().catch((err) => {
  cli.error(`${err}`);
  process.exit(1);
});
