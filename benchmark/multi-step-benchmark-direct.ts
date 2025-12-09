#!/usr/bin/env node

/**
 * Multi-Step Benchmark: Screenshots vs WebMCP Tools (Direct API Version)
 *
 * A complex, multi-step benchmark comparing token consumption between
 * screenshot-based and WebMCP tool-based browser automation approaches.
 * Uses the Anthropic SDK directly with streaming for maximum token output.
 *
 * **Task**: Create a calendar event on a complex calendar app with 15 WebMCP tools.
 *
 * **Approaches compared**:
 * 1. **Screenshot-based**: Multiple screenshots + Claude analysis for each step
 * 2. **WebMCP tool-based**: Orchestrate multiple tool calls (get state, get users,
 *    get colors, create event, verify)
 *
 * @example
 * ```bash
 * # Run the benchmark (uses live deployment by default)
 * npm run benchmark:complex:direct
 * ```
 *
 * @requires ANTHROPIC_API_KEY - In .env file or environment variable
 * @requires Chrome browser - For headless browser automation
 *
 * @module benchmark/multi-step-benchmark-direct
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, "..", ".env") });

import Anthropic from "@anthropic-ai/sdk";
import {
  // Types
  type BenchmarkResult,
  // Constants
  DEFAULT_MODEL,
  // Classes
  MCPClientWrapper,
  // Functions
  extractText,
  createTokenAccumulator,
  captureAndAnalyze,
  sendPrompt,
  sleep,
  // CLI
  cli,
  printComparisonResults,
  printCostAnalysis,
} from "./helpers.js";

const DEFAULT_CALENDAR_URL = "https://big-calendar.alexmnahas.workers.dev";

const anthropic = new Anthropic();

const benchmarkConfig = {
  model: DEFAULT_MODEL,
  devServerUrl: process.env.DEV_SERVER_URL ?? DEFAULT_CALENDAR_URL,
};

/**
 * Runs the screenshot-based approach benchmark.
 *
 * This simulates a complex workflow where an AI agent must:
 * 1. Take screenshots to understand a complex calendar UI
 * 2. Send screenshots to Claude for visual analysis
 * 3. Take DOM snapshots to find form elements
 * 4. Take verification screenshots at each step
 *
 * For a complex app, this requires many screenshots and Claude calls.
 *
 * @param mcp - MCP client wrapper for browser automation
 * @returns Benchmark results, or null if a step failed
 */
async function runScreenshotApproach(
  mcp: MCPClientWrapper
): Promise<BenchmarkResult | null> {
  cli.section("SCREENSHOT-BASED APPROACH (Complex Calendar App)");
  cli.task(
    "Create a meeting called 'Team Standup' for tomorrow at 10am",
    "Use screenshots to see and verify page state"
  );

  const tokens = createTokenAccumulator();

  cli.step(1, "Navigate to calendar...");
  await mcp.callTool("navigate_page", {
    url: benchmarkConfig.devServerUrl,
    type: "url",
  });
  await sleep(2000);
  cli.info(`Navigated to ${benchmarkConfig.devServerUrl}`);

  cli.step(2, "Take screenshot to see calendar...");
  const analysis1 = await captureAndAnalyze(
    mcp,
    anthropic,
    tokens,
    {
      prompt: `I need to create a new meeting called "Team Standup" for tomorrow at 10am on this calendar. Looking at this screenshot, describe what you see and how I might go about creating a new event. What UI elements are available?`,
    },
    benchmarkConfig
  );

  if (!analysis1) {
    return null;
  }
  cli.info(`Response: ${analysis1.responseText.substring(0, 200)}...`);

  cli.step(3, "Take DOM snapshot to find elements...");
  const snapshot = await mcp.callTool("take_snapshot", {});
  const snapshotText = extractText(snapshot);
  cli.info(`Snapshot length: ${snapshotText?.length ?? 0} chars`);

  cli.step(4, "Ask Claude to find create button...");
  const { usage: usage2 } = await sendPrompt(
    anthropic,
    `Here's a DOM snapshot of a calendar app. Find the button or element to create a new event/meeting and tell me its UID:\n\n${snapshotText ?? "No snapshot"}`,
    benchmarkConfig
  );
  tokens.addTextCall(usage2);
  cli.info(`Input tokens: ${usage2.inputTokens.toLocaleString()}`);
  cli.info(`Output tokens: ${usage2.outputTokens.toLocaleString()}`);

  cli.step(5, "(Would click create button)...");
  cli.info("Simulating: Click to open event creation dialog");

  cli.step(6, "Take screenshot of event form...");
  const analysis3 = await captureAndAnalyze(
    mcp,
    anthropic,
    tokens,
    {
      prompt: `What form fields do I see here? I need to fill in: title="Team Standup", date=tomorrow, time=10am. What elements should I interact with?`,
    },
    benchmarkConfig
  );

  if (!analysis3) {
    cli.warn("Failed to capture form screenshot");
  }

  cli.step(7, "Take snapshot to find form field UIDs...");
  const formSnapshot = await mcp.callTool("take_snapshot", {});
  const formSnapshotText = extractText(formSnapshot);
  cli.info(`Form snapshot length: ${formSnapshotText?.length ?? 0} chars`);

  cli.step(8, "Ask Claude to identify form fields...");
  const { usage: usage4 } = await sendPrompt(
    anthropic,
    `Here's a DOM snapshot of a calendar event form. Find the UIDs for: title input, description input, date picker, time picker, user selector, color selector, and submit button:\n\n${formSnapshotText ?? "No snapshot"}`,
    benchmarkConfig
  );
  tokens.addTextCall(usage4);
  cli.info(`Input tokens: ${usage4.inputTokens.toLocaleString()}`);
  cli.info(`Output tokens: ${usage4.outputTokens.toLocaleString()}`);

  cli.step(9, "(Would fill form fields)...");
  cli.info("Simulating: Fill title, description, date, time, user, color");

  cli.step(10, "Take screenshot to verify form filled...");
  const analysis5 = await captureAndAnalyze(
    mcp,
    anthropic,
    tokens,
    {
      prompt: `Is the form filled correctly with "Team Standup" for tomorrow at 10am? Should I click submit?`,
    },
    benchmarkConfig
  );

  if (!analysis5) {
    cli.warn("Failed to capture verification screenshot");
  }

  cli.step(11, "(Would click submit button)...");

  cli.step(12, "Take final verification screenshot...");
  const analysis6 = await captureAndAnalyze(
    mcp,
    anthropic,
    tokens,
    {
      prompt: `Was the "Team Standup" meeting successfully created? Can you see it on the calendar for tomorrow at 10am?`,
    },
    benchmarkConfig
  );

  if (!analysis6) {
    cli.warn("Failed to capture final screenshot");
  }

  return tokens.getResult("Screenshot-based");
}

/**
 * Runs the WebMCP tool-based approach benchmark.
 *
 * This demonstrates a multi-step semantic workflow where an AI agent:
 * 1. Lists available WebMCP tools exposed by the calendar app
 * 2. Gets calendar state to understand current date/view
 * 3. Gets users list to find valid userIds
 * 4. Gets available event colors
 * 5. Creates the event with proper arguments
 * 6. Verifies the event was created
 *
 * No screenshots needed - structured tools provide all necessary data.
 *
 * @param mcp - MCP client wrapper for browser automation
 * @returns Benchmark results
 */
async function runWebMCPApproach(
  mcp: MCPClientWrapper
): Promise<BenchmarkResult> {
  cli.section("WEBMCP TOOL-BASED APPROACH (Complex Calendar App)");
  cli.task(
    "Create a meeting called 'Team Standup' for tomorrow at 10am",
    "Use WebMCP tools directly (multi-step workflow)"
  );

  const tokens = createTokenAccumulator();

  cli.step(1, "Navigate to calendar...");
  await mcp.callTool("navigate_page", {
    url: benchmarkConfig.devServerUrl,
    type: "url",
  });
  await sleep(2000);
  cli.info(`Navigated to ${benchmarkConfig.devServerUrl}`);

  cli.step(2, "List WebMCP tools...");
  const toolsResult = await mcp.callTool("list_webmcp_tools", {});
  const toolsText = extractText(toolsResult);
  tokens.incrementToolCalls();
  cli.info(`Found tools (first 300 chars): ${toolsText?.substring(0, 300) ?? "none"}...`);

  cli.step(3, "Get calendar state...");
  const stateResult = await mcp.callTool("call_webmcp_tool", {
    name: "get_calendar_state",
    arguments: {},
  });
  const stateText = extractText(stateResult);
  tokens.incrementToolCalls();
  cli.info(`State: ${stateText?.substring(0, 150) ?? "none"}...`);

  cli.step(4, "Get users list...");
  const usersResult = await mcp.callTool("call_webmcp_tool", {
    name: "get_users",
    arguments: {},
  });
  const usersText = extractText(usersResult);
  tokens.incrementToolCalls();
  cli.info(`Users: ${usersText?.substring(0, 150) ?? "none"}...`);

  // Extract first user's UUID from the response
  let firstUserId = "";
  const userIdMatch = usersText?.match(/ID:\s*([a-f0-9-]{36})/i);
  if (userIdMatch) {
    firstUserId = userIdMatch[1];
    cli.info(`Extracted user ID: ${firstUserId}`);
  }

  cli.step(5, "Get event colors...");
  const colorsResult = await mcp.callTool("call_webmcp_tool", {
    name: "get_event_colors",
    arguments: {},
  });
  const colorsText = extractText(colorsResult);
  tokens.incrementToolCalls();
  cli.info(`Colors: ${colorsText?.substring(0, 100) ?? "none"}...`);

  cli.step(6, "Ask Claude to plan event creation...");
  const { usage: usage1, responseText } = await sendPrompt(
    anthropic,
    `I need to create a "Team Standup" meeting for tomorrow at 10am.

Available tools: ${toolsText ?? "none"}

Calendar state: ${stateText ?? "none"}

Users: ${usersText ?? "none"}

Colors: ${colorsText ?? "none"}

What arguments should I pass to create_event? Reply with just the JSON arguments.`,
    benchmarkConfig
  );
  tokens.addTextCall(usage1);
  cli.info(`Input tokens: ${usage1.inputTokens.toLocaleString()}`);
  cli.info(`Output tokens: ${usage1.outputTokens.toLocaleString()}`);
  cli.info(`Response: ${responseText.substring(0, 200)}`);

  cli.step(7, "Call create_event tool...");

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const startDate = new Date(tomorrow);
  startDate.setHours(10, 0, 0, 0);
  const endDate = new Date(tomorrow);
  endDate.setHours(11, 0, 0, 0);

  const createResult = await mcp.callTool("call_webmcp_tool", {
    name: "create_event",
    arguments: {
      title: "Team Standup",
      description: "Daily team standup meeting",
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      userId: firstUserId,
      color: "blue",
    },
  });
  tokens.incrementToolCalls();

  const createText = extractText(createResult);
  cli.info(`Result: ${createText?.substring(0, 200) ?? "no response"}`);

  cli.step(8, "Get events to verify creation...");
  const month = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}`;
  const eventsResult = await mcp.callTool("call_webmcp_tool", {
    name: "get_events",
    arguments: { month },
  });
  tokens.incrementToolCalls();

  const eventsText = extractText(eventsResult);
  cli.info(`Events: ${eventsText?.substring(0, 200) ?? "none"}...`);

  cli.step(9, "Verify result with Claude...");
  const { usage: usage2, responseText: confirmText } = await sendPrompt(
    anthropic,
    `I created a "Team Standup" event. Create response: "${createText ?? "none"}". Then I searched for it and got: "${eventsText ?? "none"}". Was it created successfully?`,
    benchmarkConfig
  );
  tokens.addTextCall(usage2);
  cli.info(`Input tokens: ${usage2.inputTokens.toLocaleString()}`);
  cli.info(`Output tokens: ${usage2.outputTokens.toLocaleString()}`);
  cli.info(`Response: ${confirmText}`);

  return tokens.getResult("WebMCP tool-based");
}

/**
 * Main entry point for the benchmark.
 *
 * Initializes the MCP client, runs both approaches, and prints comparison results.
 */
async function main(): Promise<void> {
  cli.header("MULTI-STEP BENCHMARK: Big Calendar App\nScreenshots vs WebMCP Tools");

  if (!process.env.ANTHROPIC_API_KEY) {
    cli.error("ANTHROPIC_API_KEY environment variable not set");
    process.exit(1);
  }

  cli.config(benchmarkConfig.model, benchmarkConfig.devServerUrl);
  cli.info("Using live big-calendar deployment");

  const mcp = new MCPClientWrapper();

  try {
    await mcp.connect({ headless: true });

    const screenshotResults = await runScreenshotApproach(mcp);
    const webmcpResults = await runWebMCPApproach(mcp);

    if (!screenshotResults || !webmcpResults) {
      cli.error("One of the approaches failed");
      process.exit(1);
    }

    printComparisonResults(screenshotResults, webmcpResults);
    printCostAnalysis(screenshotResults, webmcpResults);
  } catch (error) {
    cli.error(`Error: ${error}`);
    process.exit(1);
  } finally {
    await mcp.close();
  }
}

main();
