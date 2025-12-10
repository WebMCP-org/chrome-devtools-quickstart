#!/usr/bin/env node

/**
 * Simple Benchmark: Chrome DevTools vs WebMCP vs Playwright (Agent SDK Version)
 *
 * A realistic benchmark comparing token consumption between three different
 * browser automation approaches using the Claude Agent SDK.
 *
 * **Approaches compared**:
 * 1. **Chrome DevTools (Screenshot)**: Uses the official Google Chrome DevTools MCP server
 *    with screenshot-based visual inspection
 * 2. **WebMCP Tools**: Uses the @mcp-b/chrome-devtools-mcp fork with semantic WebMCP tools
 * 3. **Playwright**: Uses Microsoft's @playwright/mcp server with accessibility tree
 *
 * **Task**: Set a counter value on a simple counter app.
 *
 * @example
 * ```bash
 * # Run the benchmark (dev server starts automatically)
 * npm run benchmark:simple
 * ```
 *
 * @requires ANTHROPIC_API_KEY - In .env file or environment variable
 * @requires Chrome browser - For Chrome DevTools approaches
 *
 * @module benchmark/simple-benchmark
 */

import { config } from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { spawn, ChildProcess } from "child_process";
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

// ============================================================
// Configuration
// ============================================================

const NUM_RUNS = 3;
const TASK = "Navigate to http://localhost:5173, find the current counter value, set it to 42, and verify it was set correctly.";

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

Steps:
1. Navigate to the page
2. Take a SCREENSHOT to see the current state
3. Analyze the screenshot to understand the UI
4. Use take_snapshot to find element UIDs for clicking/filling
5. Perform actions (click, fill)
6. Take another SCREENSHOT to verify the result

Always take screenshots before and after important actions.`,

  webmcp: `You are a browser automation agent. The page you're testing has WebMCP tools available that expose semantic APIs for the application's functionality.

IMPORTANT: Prioritize using WebMCP tools (via list_webmcp_tools and call_webmcp_tool) over taking screenshots. Only use screenshots if WebMCP tools are unavailable or you need visual verification. WebMCP tools provide direct programmatic access to the application's state and actions.

Typical workflow:
1. Navigate to the page
2. List available WebMCP tools to discover the API
3. Use call_webmcp_tool to interact with the app semantically
4. Verify using WebMCP tools or minimal screenshots`,

  playwright: `You are a browser automation agent using Playwright.

Use Playwright's browser automation tools to interact with the page. The tools work with an accessibility tree (not screenshots), making interactions fast and reliable.

Steps:
1. Navigate to the page using browser_navigate
2. Use browser_snapshot to get the accessibility tree and find elements
3. Interact with elements using browser_click, browser_type, etc.
4. Use browser_snapshot again to verify the result

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
  cli.header("Simple Benchmark: Chrome DevTools vs WebMCP vs Playwright\nAgent SDK Version");

  cli.section("STARTING DEV SERVER");
  try {
    await startDevServer();
  } catch (err) {
    cli.error(`Failed to start dev server: ${err}`);
    process.exit(1);
  }

  cli.info(`Task: ${TASK}`);
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

  stopDevServer();
  cli.success("Benchmark complete");
}

main().catch((err) => {
  cli.error(`${err}`);
  stopDevServer();
  process.exit(1);
});
