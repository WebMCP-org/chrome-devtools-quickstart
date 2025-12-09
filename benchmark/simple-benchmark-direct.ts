#!/usr/bin/env node

/**
 * Simple Benchmark: Screenshots vs WebMCP Tools (Direct API Version)
 *
 * A straightforward, single-step benchmark comparing token consumption between
 * screenshot-based and WebMCP tool-based browser automation approaches.
 * Uses the Anthropic SDK directly with streaming for maximum token output.
 *
 * **Task**: Set a counter value on a simple counter app.
 *
 * **Approaches compared**:
 * 1. **Screenshot-based**: Take screenshots, send to Claude, parse response
 * 2. **WebMCP tool-based**: List tools, call set_counter directly
 *
 * @example
 * ```bash
 * # Run the benchmark (dev server starts automatically)
 * npm run benchmark:simple:direct
 * ```
 *
 * @requires ANTHROPIC_API_KEY - In .env file or environment variable
 * @requires Chrome browser - For headless browser automation
 *
 * @module benchmark/simple-benchmark-direct
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn, ChildProcess } from "child_process";

// Load .env from project root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
config({ path: join(projectRoot, ".env") });

let devServerProcess: ChildProcess | null = null;

async function startDevServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    cli.info("Starting Vite dev server...");

    devServerProcess = spawn("npm", ["run", "dev"], {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        reject(new Error("Dev server startup timeout"));
      }
    }, 30000);

    devServerProcess.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output.includes("localhost:5173") || output.includes("Local:")) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          cli.success("Dev server ready at http://localhost:5173");
          setTimeout(resolve, 1000);
        }
      }
    });

    devServerProcess.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      if (output.includes("localhost:5173") || output.includes("Local:")) {
        if (!started) {
          started = true;
          clearTimeout(timeout);
          cli.success("Dev server ready at http://localhost:5173");
          setTimeout(resolve, 1000);
        }
      }
    });

    devServerProcess.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    devServerProcess.on("exit", (code) => {
      if (!started && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Dev server exited with code ${code}`));
      }
    });
  });
}

function stopDevServer(): void {
  if (devServerProcess) {
    cli.info("Stopping dev server...");
    devServerProcess.kill("SIGTERM");
    devServerProcess = null;
  }
}

// Ensure cleanup on exit
process.on("SIGINT", () => {
  stopDevServer();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopDevServer();
  process.exit(0);
});

process.on("exit", () => {
  stopDevServer();
});

import Anthropic from "@anthropic-ai/sdk";
import {
  // Types
  type BenchmarkResult,
  // Constants
  DEFAULT_MODEL,
  DEFAULT_DEV_SERVER_URL,
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

const anthropic = new Anthropic();

const benchmarkConfig = {
  model: DEFAULT_MODEL,
  devServerUrl: process.env.DEV_SERVER_URL ?? DEFAULT_DEV_SERVER_URL,
};

/**
 * Runs the screenshot-based approach benchmark.
 *
 * This simulates the traditional workflow where an AI agent must:
 * 1. Take screenshots to understand page state
 * 2. Send screenshots to Claude for visual analysis
 * 3. Take additional screenshots to verify actions
 *
 * Each screenshot adds ~1,500+ tokens to the context.
 *
 * @param mcp - MCP client wrapper for browser automation
 * @returns Benchmark results, or null if screenshot capture failed
 */
async function runScreenshotApproach(
  mcp: MCPClientWrapper
): Promise<BenchmarkResult | null> {
  cli.section("SCREENSHOT-BASED APPROACH");
  cli.task(
    "Navigate to the counter app and set the counter to 42",
    "Use screenshots to see and verify page state"
  );

  const tokens = createTokenAccumulator();

  cli.step(1, "Navigate to page...");
  await mcp.callTool("navigate_page", {
    url: benchmarkConfig.devServerUrl,
    type: "url",
  });
  cli.info(`Navigated to ${benchmarkConfig.devServerUrl}`);

  cli.step(2, "Take screenshot to see page...");
  const analysis1 = await captureAndAnalyze(
    mcp,
    anthropic,
    tokens,
    {
      prompt:
        "I need to set the counter on this page to 42. Looking at this screenshot, what do I see and what element should I interact with to change the counter value? Just describe what you see and suggest what to do next.",
    },
    benchmarkConfig
  );

  if (!analysis1) {
    return null;
  }

  cli.step(3, "Take DOM snapshot to find elements...");
  const snapshot = await mcp.callTool("take_snapshot", {});
  const snapshotText = extractText(snapshot);

  if (snapshotText) {
    cli.step(4, "Ask Claude to identify element from snapshot...");
    const { usage } = await sendPrompt(
      anthropic,
      `Here's a DOM snapshot of the page. Find the button element that controls the counter and tell me its UID:\n\n${snapshotText}`,
      benchmarkConfig
    );
    tokens.addTextCall(usage);
    cli.info(`Input tokens: ${usage.inputTokens.toLocaleString()}`);
    cli.info(`Output tokens: ${usage.outputTokens.toLocaleString()}`);
  } else {
    cli.warn("Failed to get DOM snapshot");
  }

  // Step 6: Interaction step (skipped for benchmark)
  cli.step(5, "Interact with element...");
  cli.info("(Interaction step - skipped for benchmark)");

  cli.step(6, "Take verification screenshot...");
  const analysis2 = await captureAndAnalyze(
    mcp,
    anthropic,
    tokens,
    {
      prompt: "Did the counter get set to 42? What value does it show now?",
    },
    benchmarkConfig
  );

  if (!analysis2) {
    cli.warn("Failed to capture verification screenshot");
  }

  return tokens.getResult("Screenshot-based");
}

/**
 * Runs the WebMCP tool-based approach benchmark.
 *
 * This demonstrates the semantic approach where an AI agent:
 * 1. Lists available WebMCP tools exposed by the page
 * 2. Calls the appropriate tool directly with structured arguments
 * 3. Receives a JSON response confirming the action
 *
 * No screenshots needed - the tools provide semantic understanding.
 *
 * @param mcp - MCP client wrapper for browser automation
 * @returns Benchmark results
 */
async function runWebMCPApproach(
  mcp: MCPClientWrapper
): Promise<BenchmarkResult> {
  cli.section("WEBMCP TOOL-BASED APPROACH");
  cli.task(
    "Navigate to the counter app and set the counter to 42",
    "Use WebMCP tools directly"
  );

  const tokens = createTokenAccumulator();

  cli.step(1, "Navigate to page...");
  await mcp.callTool("navigate_page", {
    url: benchmarkConfig.devServerUrl,
    type: "url",
  });
  cli.info(`Navigated to ${benchmarkConfig.devServerUrl}`);

  await sleep(1000);

  cli.step(2, "List WebMCP tools...");
  const toolsResult = await mcp.callTool("list_webmcp_tools", {});
  const toolsText = extractText(toolsResult);
  tokens.incrementToolCalls();

  if (toolsText) {
    cli.info(`Available tools: ${toolsText.substring(0, 200)}...`);
  } else {
    cli.warn("No WebMCP tools found on page");
  }

  cli.step(3, "Ask Claude to select tool...");
  const { usage: usage1 } = await sendPrompt(
    anthropic,
    `Given these available WebMCP tools:\n${toolsText ?? "none"}\n\nWhich tool should I call to set the counter to 42, and what arguments should I pass? Reply with just the tool name and arguments as JSON.`,
    benchmarkConfig
  );
  tokens.addTextCall(usage1);
  cli.info(`Input tokens: ${usage1.inputTokens.toLocaleString()}`);
  cli.info(`Output tokens: ${usage1.outputTokens.toLocaleString()}`);

  cli.step(4, "Call set_counter tool...");
  const setResult = await mcp.callTool("call_webmcp_tool", {
    name: "set_counter",
    arguments: { newCounterValue: 42 },
  });
  const resultText = extractText(setResult);
  tokens.incrementToolCalls();
  cli.info(`Result: ${resultText ?? "no response"}`);

  cli.step(5, "Verify result with Claude...");
  const { usage: usage2 } = await sendPrompt(
    anthropic,
    `I called the set_counter WebMCP tool with newCounterValue: 42 and got this response: "${resultText ?? "no response"}". Was the operation successful?`,
    benchmarkConfig
  );
  tokens.addTextCall(usage2);
  cli.info(`Input tokens: ${usage2.inputTokens.toLocaleString()}`);
  cli.info(`Output tokens: ${usage2.outputTokens.toLocaleString()}`);

  return tokens.getResult("WebMCP tool-based");
}

/**
 * Main entry point for the benchmark.
 *
 * Initializes the MCP client, runs both approaches, and prints comparison results.
 */
async function main(): Promise<void> {
  cli.header("SIMPLE BENCHMARK: Counter App\nScreenshots vs WebMCP Tools");

  if (!process.env.ANTHROPIC_API_KEY) {
    cli.error("ANTHROPIC_API_KEY environment variable not set");
    process.exit(1);
  }

  cli.config(benchmarkConfig.model, benchmarkConfig.devServerUrl);

  cli.info("Starting dev server...");
  try {
    await startDevServer();
  } catch (err) {
    cli.error(`Failed to start dev server: ${err}`);
    process.exit(1);
  }

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
    stopDevServer();
  }
}

main().catch((err) => {
  cli.error(`${err}`);
  stopDevServer();
  process.exit(1);
});
