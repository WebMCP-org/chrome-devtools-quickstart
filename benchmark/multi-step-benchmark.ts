#!/usr/bin/env node

/**
 * Multi-Step Benchmark: Chrome DevTools vs WebMCP vs Playwright (Agent SDK Version)
 *
 * A realistic benchmark comparing token consumption between three different
 * browser automation approaches for complex, multi-step tasks.
 *
 * **Approaches compared**:
 * 1. **Chrome DevTools (Screenshot)**: Uses the official Google Chrome DevTools MCP server
 *    with screenshot-based visual inspection
 * 2. **WebMCP Tools**: Uses the @mcp-b/chrome-devtools-mcp fork with semantic WebMCP tools
 * 3. **Playwright**: Uses Microsoft's @playwright/mcp server with accessibility tree
 *
 * **Task**: Create a calendar event on a complex calendar app.
 *
 * @example
 * ```bash
 * # Run the benchmark (uses live deployment by default)
 * npm run benchmark:complex
 * ```
 *
 * @requires ANTHROPIC_API_KEY - In .env file or environment variable
 * @requires Chrome browser - For Chrome DevTools approaches
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
  printThreeWayComparisonResults,
  printThreeWayCostAnalysis,
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

/**
 * MCP Server configurations for each approach.
 *
 * - Chrome DevTools: Official Google Chrome DevTools MCP server (screenshot-based)
 * - WebMCP: Fork with semantic WebMCP tool support
 * - Playwright: Microsoft's official Playwright MCP server (accessibility tree-based)
 */
const MCP_SERVERS = {
  chromeDevTools: {
    "chrome-devtools": {
      command: "npx",
      args: ["-y", "chrome-devtools-mcp@latest", "--headless"],
    },
  },
  webmcp: {
    "chrome-devtools": {
      command: "npx",
      args: ["-y", "@mcp-b/chrome-devtools-mcp@latest", "--headless"],
    },
  },
  playwright: {
    playwright: {
      command: "npx",
      args: ["-y", "@playwright/mcp@latest", "--headless"],
    },
  },
};

/**
 * System prompts tailored for each approach.
 */
const SYSTEM_PROMPTS = {
  chromeDevTools: `You are a browser automation agent using Chrome DevTools.

IMPORTANT: You MUST use take_screenshot to visually inspect the page. Do NOT rely solely on take_snapshot (DOM snapshots). Take actual screenshots to see what's on screen, analyze the visual layout, and verify your actions.

For complex multi-step tasks like creating calendar events:
1. Navigate to the page
2. Take a SCREENSHOT to see the current calendar state
3. Analyze the screenshot to understand the UI layout
4. Use take_snapshot to find element UIDs for clicking/filling
5. Click buttons and fill forms step by step
6. Take a SCREENSHOT after each major action to verify
7. Take a final SCREENSHOT to confirm the event was created

Always take screenshots before and after important actions.`,

  webmcp: `You are a browser automation agent. The page you're testing has WebMCP tools available that expose semantic APIs for the application's functionality.

IMPORTANT: Prioritize using WebMCP tools (via list_webmcp_tools and call_webmcp_tool) over taking screenshots. Only use screenshots if WebMCP tools are unavailable or you need visual verification. WebMCP tools provide direct programmatic access to the application's state and actions.

For calendar applications, look for tools like:
- get_calendar_state - to see current events
- get_users - to see available users
- get_event_colors - to see color options
- create_event - to create new events
- get_events - to verify creation

Typical workflow:
1. Navigate to the page
2. List available WebMCP tools to discover the API
3. Use call_webmcp_tool to interact with the app semantically
4. Verify using WebMCP tools or minimal screenshots`,

  playwright: `You are a browser automation agent using Playwright.

Use Playwright's browser automation tools to interact with the page. The tools work with an accessibility tree (not screenshots), making interactions fast and reliable.

For complex multi-step tasks like creating calendar events:
1. Navigate to the page using browser_navigate
2. Use browser_snapshot to get the accessibility tree and understand the UI
3. Interact with elements using browser_click, browser_type, browser_select_option, etc.
4. Fill forms step by step
5. Use browser_snapshot to verify after each major action
6. Confirm the event was created

Prefer using the accessibility tree over screenshots for efficiency.`,
};

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
// Benchmark Functions for Each Approach
// ============================================================

async function runChromeDevToolsBenchmark(): Promise<BenchmarkResult> {
  return runAgentBenchmark({
    task: TASK,
    systemPrompt: SYSTEM_PROMPTS.chromeDevTools,
    mcpServers: MCP_SERVERS.chromeDevTools,
  });
}

async function runWebMCPBenchmark(): Promise<BenchmarkResult> {
  return runAgentBenchmark({
    task: TASK,
    systemPrompt: SYSTEM_PROMPTS.webmcp,
    mcpServers: MCP_SERVERS.webmcp,
  });
}

async function runPlaywrightBenchmark(): Promise<BenchmarkResult> {
  return runAgentBenchmark({
    task: TASK,
    systemPrompt: SYSTEM_PROMPTS.playwright,
    mcpServers: MCP_SERVERS.playwright,
  });
}

// ============================================================
// Main
// ============================================================

async function main(): Promise<void> {
  cli.header("Multi-Step Benchmark: Chrome DevTools vs WebMCP vs Playwright\nAgent SDK Version");

  cli.info(`Calendar URL: ${CALENDAR_URL}`);
  cli.info(`Runs per approach: ${NUM_RUNS}`);
  cli.info("Using Claude Agent SDK for realistic agentic behavior");
  cli.info("");
  cli.info("Approaches:");
  cli.info("  1. Chrome DevTools (chrome-devtools-mcp) - Screenshot-based");
  cli.info("  2. WebMCP (@mcp-b/chrome-devtools-mcp) - Semantic tool-based");
  cli.info("  3. Playwright (@playwright/mcp) - Accessibility tree-based");

  const chromeDevToolsResults: BenchmarkResult[] = [];
  const webmcpResults: BenchmarkResult[] = [];
  const playwrightResults: BenchmarkResult[] = [];

  for (let i = 0; i < NUM_RUNS; i++) {
    cli.section(`RUN ${i + 1}/${NUM_RUNS}`);

    // Chrome DevTools approach
    cli.info("Running Chrome DevTools approach...");
    const chromeResult = await runChromeDevToolsBenchmark();
    chromeDevToolsResults.push(chromeResult);
    if (chromeResult.success) {
      cli.success(
        `Completed: ${chromeResult.inputTokens.toLocaleString()} in / ${chromeResult.outputTokens.toLocaleString()} out, $${chromeResult.totalCostUsd.toFixed(4)}`
      );
    } else {
      cli.error("Failed");
    }

    // WebMCP approach
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

    // Playwright approach
    cli.info("Running Playwright approach...");
    const playwrightResult = await runPlaywrightBenchmark();
    playwrightResults.push(playwrightResult);
    if (playwrightResult.success) {
      cli.success(
        `Completed: ${playwrightResult.inputTokens.toLocaleString()} in / ${playwrightResult.outputTokens.toLocaleString()} out, $${playwrightResult.totalCostUsd.toFixed(4)}`
      );
    } else {
      cli.error("Failed");
    }
  }

  // Aggregate results
  const chromeDevToolsAgg = aggregateBenchmarkResults("Chrome DevTools", chromeDevToolsResults);
  const webmcpAgg = aggregateBenchmarkResults("WebMCP", webmcpResults);
  const playwrightAgg = aggregateBenchmarkResults("Playwright", playwrightResults);

  // Print individual results
  cli.section("CHROME DEVTOOLS APPROACH RESULTS");
  printAgentApproachResults(chromeDevToolsAgg);

  cli.section("WEBMCP APPROACH RESULTS");
  printAgentApproachResults(webmcpAgg);

  cli.section("PLAYWRIGHT APPROACH RESULTS");
  printAgentApproachResults(playwrightAgg);

  // Print comparison (Chrome DevTools as baseline)
  printThreeWayComparisonResults(
    [chromeDevToolsAgg, webmcpAgg, playwrightAgg],
    "FINAL COMPARISON"
  );
  printThreeWayCostAnalysis([chromeDevToolsAgg, webmcpAgg, playwrightAgg]);

  cli.success("Benchmark complete");
}

main().catch((err) => {
  cli.error(`${err}`);
  process.exit(1);
});
