/**
 * Benchmark Helper Utilities
 *
 * Provides shared types, utilities, and abstractions for benchmark scripts.
 * Includes MCP client management, token tracking, Claude API helpers, and
 * styled CLI output using chalk and cli-table3.
 *
 * @module benchmark/helpers
 */

import chalk from "chalk";
import Table from "cli-table3";
import { PNG } from "pngjs";
import jpeg from "jpeg-js";

interface MCPContentItem {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

interface MCPResultWithContent {
  content?: MCPContentItem[];
}
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CompatibilityCallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type { CompatibilityCallToolResult };

export type ImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export interface ExtractedImage {
  data: string;
  mimeType: ImageMimeType;
}

export interface BenchmarkResult {
  approach: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  imageTokens: number;
  screenshotsTaken: number;
  toolCallCount?: number;
}

export interface AgentBenchmarkResult {
  success: boolean;
  inputTokens: number;
  outputTokens: number;
  imageTokens: number;
  totalCostUsd: number;
  durationMs: number;
  numTurns: number;
  toolUsage?: Record<string, number>;
}

export interface AggregatedBenchmarkResults {
  approach: string;
  runs: AgentBenchmarkResult[];
  avgInputTokens: number;
  avgOutputTokens: number;
  avgImageTokens: number;
  avgTotalCostUsd: number;
  avgDurationMs: number;
  avgNumTurns: number;
  successRate: number;
  totalToolUsage?: Record<string, number>;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BenchmarkConfig {
  model: string;
  devServerUrl: string;
}

export interface ScreenshotAnalysisOptions {
  prompt: string;
}

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
export const DEFAULT_DEV_SERVER_URL = "http://localhost:5173";

export const PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
} as const;

export function calculateImageTokens(width: number, height: number): number {
  return Math.ceil((width * height) / 750);
}

export function getImageDimensions(
  base64Data: string,
  mimeType: ImageMimeType
): { width: number; height: number } | null {
  try {
    const buffer = Buffer.from(base64Data, "base64");

    if (mimeType === "image/png") {
      const png = PNG.sync.read(buffer);
      return { width: png.width, height: png.height };
    }

    if (mimeType === "image/jpeg") {
      const decoded = jpeg.decode(buffer, { useTArray: true });
      return { width: decoded.width, height: decoded.height };
    }

    if (mimeType === "image/gif") {
      if (buffer.length >= 10) {
        const width = buffer.readUInt16LE(6);
        const height = buffer.readUInt16LE(8);
        return { width, height };
      }
    }

    if (mimeType === "image/webp") {
      if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF") {
        const webpType = buffer.toString("ascii", 8, 12);
        if (webpType === "WEBP") {
          if (buffer.toString("ascii", 12, 16) === "VP8 ") {
            const width = buffer.readUInt16LE(26) & 0x3fff;
            const height = buffer.readUInt16LE(28) & 0x3fff;
            return { width, height };
          }
          if (buffer.toString("ascii", 12, 16) === "VP8L") {
            const bits = buffer.readUInt32LE(21);
            const width = (bits & 0x3fff) + 1;
            const height = ((bits >> 14) & 0x3fff) + 1;
            return { width, height };
          }
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function calculateImageTokensFromBase64(
  base64Data: string,
  mimeType: ImageMimeType
): number | null {
  const dimensions = getImageDimensions(base64Data, mimeType);
  if (!dimensions) return null;
  return calculateImageTokens(dimensions.width, dimensions.height);
}

const VALID_IMAGE_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

/**
 * Gets image dimensions from base64-encoded image data.
 *
 * @param base64Data - Base64-encoded image data
 * @param mimeType - MIME type of the image
 * @returns Image dimensions { width, height } or null if unable to parse
 */
export function isValidImageMimeType(
  mimeType: string
): mimeType is ImageMimeType {
  return VALID_IMAGE_MIME_TYPES.includes(mimeType as ImageMimeType);
}

/**
 * Extracts text content from an MCP tool result.
 *
 * @param result - The tool result from an MCP call
 * @returns The extracted text, or undefined if no text content exists
 *
 * @example
 * ```typescript
 * const result = await mcp.callTool("take_snapshot", {});
 * const text = extractText(result);
 * if (text) {
 *   console.log("Snapshot:", text.substring(0, 100));
 * }
 * ```
 */
export function extractText(
  result: CompatibilityCallToolResult
): string | undefined {
  const r = result as MCPResultWithContent;
  if (!r.content) return undefined;
  const textContent = r.content.find((c) => c.type === "text");
  return textContent?.text;
}

/**
 * Extracts image data from an MCP screenshot result.
 *
 * Validates that the MIME type is supported by Claude API before returning.
 *
 * @param result - The tool result from a take_screenshot call
 * @returns Extracted image with validated MIME type, or undefined if invalid
 *
 * @example
 * ```typescript
 * const result = await mcp.callTool("take_screenshot", {});
 * const image = extractImage(result);
 * if (image) {
 *   // image.mimeType is guaranteed to be valid
 *   const buffer = Buffer.from(image.data, "base64");
 * }
 * ```
 */
export function extractImage(
  result: CompatibilityCallToolResult
): ExtractedImage | undefined {
  const r = result as MCPResultWithContent;
  if (!r.content) return undefined;
  const imageContent = r.content.find((c) => c.type === "image");
  if (!imageContent?.data || !imageContent.mimeType) return undefined;

  if (!isValidImageMimeType(imageContent.mimeType)) {
    return undefined;
  }

  return {
    data: imageContent.data,
    mimeType: imageContent.mimeType,
  };
}

/**
 * MCP client wrapper providing type-safe tool calls and lifecycle management.
 *
 * Encapsulates the MCP client connection and provides a clean interface
 * for calling tools without managing global state.
 *
 * @example
 * ```typescript
 * const mcp = new MCPClientWrapper();
 * await mcp.connect({ headless: true });
 *
 * const result = await mcp.callTool("navigate_page", { url: "https://example.com" });
 *
 * await mcp.close();
 * ```
 */
export class MCPClientWrapper {
  private client: Client | null = null;

  /**
   * Initializes the Chrome DevTools MCP server and establishes connection.
   *
   * @param options - Configuration options
   * @param options.headless - Run browser in headless mode (default: true)
   * @returns This wrapper instance for chaining
   * @throws Error if connection fails
   */
  async connect(options?: { headless?: boolean }): Promise<this> {
    const headless = options?.headless ?? true;

    cli.info("Starting Chrome DevTools MCP server...");

    const transport = new StdioClientTransport({
      command: "npx",
      args: [
        "@mcp-b/chrome-devtools-mcp@latest",
        ...(headless ? ["--headless"] : []),
      ],
    });

    this.client = new Client({
      name: "benchmark-client",
      version: "1.0.0",
    });

    await this.client.connect(transport);
    cli.success("MCP client connected");

    const tools = await this.client.listTools();
    cli.info(`Available MCP tools: ${tools.tools.length}`);

    // Set viewport to 14-inch MacBook size for realistic screenshots
    await this.callTool("resize_page", { width: 1512, height: 982 });
    cli.info("Browser viewport set to 1512x982");

    return this;
  }

  /**
   * Executes an MCP tool call with type-safe arguments.
   *
   * @param name - Tool name to call
   * @param args - Arguments to pass to the tool
   * @returns The tool result
   * @throws Error if client is not connected
   */
  async callTool(
    name: string,
    args: Record<string, unknown> = {}
  ): Promise<CompatibilityCallToolResult> {
    if (!this.client) {
      throw new Error("MCP client not initialized. Call connect() first.");
    }
    return this.client.callTool({ name, arguments: args });
  }

  /**
   * Closes the MCP client connection.
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Returns whether the client is connected.
   */
  get isConnected(): boolean {
    return this.client !== null;
  }
}

/**
 * Token accumulator for tracking usage across multiple Claude API calls.
 */
export interface TokenAccumulator {
  addImageCall(usage: TokenUsage, imageTokens: number): void;
  addTextCall(usage: TokenUsage): void;
  incrementScreenshots(): void;
  incrementToolCalls(count?: number): void;
  getResult(approach: string): BenchmarkResult;
}

/**
 * Creates a token accumulator for tracking usage across multiple calls.
 *
 * @returns Token accumulator with methods to track usage
 *
 * @example
 * ```typescript
 * const tokens = createTokenAccumulator();
 *
 * // Calculate image tokens from the actual image
 * const imageTokens = calculateImageTokensFromBase64(image.data, image.mimeType);
 *
 * // After each Claude call
 * tokens.addImageCall({ inputTokens: 1500, outputTokens: 200 }, imageTokens ?? 0);
 * tokens.incrementScreenshots();
 *
 * // Get final results
 * const result = tokens.getResult("Screenshot-based");
 * ```
 */
export function createTokenAccumulator(): TokenAccumulator {
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let imageTokensTotal = 0;
  let screenshotCount = 0;
  let toolCallCount = 0;

  return {
    addImageCall(usage: TokenUsage, imageTokens: number): void {
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
      // Use the calculated image tokens (from width * height / 750)
      imageTokensTotal += imageTokens;
    },

    addTextCall(usage: TokenUsage): void {
      totalInputTokens += usage.inputTokens;
      totalOutputTokens += usage.outputTokens;
    },

    incrementScreenshots(): void {
      screenshotCount++;
    },

    incrementToolCalls(count = 1): void {
      toolCallCount += count;
    },

    getResult(approach: string): BenchmarkResult {
      return {
        approach,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        imageTokens: imageTokensTotal,
        screenshotsTaken: screenshotCount,
        toolCallCount: toolCallCount > 0 ? toolCallCount : undefined,
      };
    },
  };
}

/**
 * Analyzes a screenshot using Claude and returns token usage.
 *
 * @param anthropic - Anthropic client instance
 * @param image - Extracted image data from MCP
 * @param options - Analysis options including prompt
 * @param config - Benchmark configuration with model
 * @returns Token usage and response text
 *
 * @example
 * ```typescript
 * const image = extractImage(screenshotResult);
 * if (image) {
 *   const { usage, responseText } = await analyzeScreenshot(
 *     anthropic,
 *     image,
 *     { prompt: "What do you see?", maxTokens: 1024 },
 *     { model: DEFAULT_MODEL }
 *   );
 * }
 * ```
 */
export async function analyzeScreenshot(
  anthropic: Anthropic,
  image: ExtractedImage,
  options: ScreenshotAnalysisOptions,
  config: { model: string }
): Promise<{ usage: TokenUsage; responseText: string }> {
  const stream = anthropic.messages.stream({
    model: config.model,
    max_tokens: 64000,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: image.mimeType,
              data: image.data,
            },
          },
          {
            type: "text",
            text: options.prompt,
          },
        ],
      },
    ],
  });

  let responseText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      responseText += event.delta.text;
    }
  }

  const finalMessage = await stream.finalMessage();

  return {
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
    responseText,
  };
}

/**
 * Sends a text-only prompt to Claude and returns token usage.
 *
 * @param anthropic - Anthropic client instance
 * @param prompt - The text prompt to send
 * @param config - Benchmark configuration with model
 * @returns Token usage and response text
 */
export async function sendPrompt(
  anthropic: Anthropic,
  prompt: string,
  config: { model: string }
): Promise<{ usage: TokenUsage; responseText: string }> {
  const stream = anthropic.messages.stream({
    model: config.model,
    max_tokens: 64000,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  let responseText = "";
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      responseText += event.delta.text;
    }
  }

  const finalMessage = await stream.finalMessage();

  return {
    usage: {
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
    },
    responseText,
  };
}

/**
 * Captures a screenshot, analyzes it with Claude, and tracks metrics.
 *
 * This is the primary helper for the repeated screenshot analysis pattern.
 * It handles screenshot capture, image extraction, Claude API call, and
 * token tracking in one convenient function.
 *
 * @param mcp - MCP client wrapper
 * @param anthropic - Anthropic client instance
 * @param tokens - Token accumulator for tracking usage
 * @param options - Analysis options
 * @param config - Benchmark configuration
 * @returns Response text, or null if screenshot capture failed
 *
 * @example
 * ```typescript
 * const analysis = await captureAndAnalyze(mcp, anthropic, tokens, {
 *   prompt: "What do you see?",
 *   maxTokens: 1024,
 * }, config);
 *
 * if (analysis) {
 *   cli.info(`Response: ${analysis.responseText.substring(0, 200)}...`);
 * }
 * ```
 */
export async function captureAndAnalyze(
  mcp: MCPClientWrapper,
  anthropic: Anthropic,
  tokens: TokenAccumulator,
  options: ScreenshotAnalysisOptions,
  config: { model: string }
): Promise<{ responseText: string } | null> {
  const result = await mcp.callTool("take_screenshot", {});
  const image = extractImage(result);

  if (!image) {
    cli.error("Failed to capture screenshot");
    return null;
  }

  const buffer = Buffer.from(image.data, "base64");
  cli.info(`Screenshot size: ${formatBytes(buffer.length)}`);
  tokens.incrementScreenshots();

  const imageTokens = calculateImageTokensFromBase64(image.data, image.mimeType) ?? 0;
  const dimensions = getImageDimensions(image.data, image.mimeType);
  if (dimensions) {
    cli.info(`Image dimensions: ${dimensions.width}x${dimensions.height} (${imageTokens} tokens)`);
  }

  const { usage, responseText } = await analyzeScreenshot(
    anthropic,
    image,
    options,
    config
  );

  tokens.addImageCall(usage, imageTokens);
  cli.info(`Input tokens (with image): ${formatNumber(usage.inputTokens)}`);
  cli.info(`Output tokens: ${formatNumber(usage.outputTokens)}`);

  return { responseText };
}

/**
 * Formats a number with thousands separators.
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Formats bytes as a human-readable string.
 */
function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export const cli = {
  header(title: string): void {
    const lines = title.split("\n");
    const maxLen = Math.max(...lines.map((l) => l.length), 58);
    const border = "─".repeat(maxLen + 2);

    console.log();
    console.log(chalk.cyan(`┌${border}┐`));
    for (const line of lines) {
      const padded = line.padEnd(maxLen);
      console.log(chalk.cyan("│ ") + chalk.bold.white(padded) + chalk.cyan(" │"));
    }
    console.log(chalk.cyan(`└${border}┘`));
    console.log();
  },

  section(title: string): void {
    console.log();
    console.log(chalk.cyan("─".repeat(60)));
    console.log(chalk.bold.white(`  ${title}`));
    console.log(chalk.cyan("─".repeat(60)));
    console.log();
  },

  step(num: number, description: string): void {
    console.log(chalk.cyan(`\n  Step ${num}: `) + chalk.white(description));
  },

  info(message: string): void {
    console.log(chalk.gray("    → ") + message);
  },

  success(message: string): void {
    console.log(chalk.green("    ✓ ") + message);
  },

  error(message: string): void {
    console.log(chalk.red("    ✗ ") + message);
  },

  warn(message: string): void {
    console.log(chalk.yellow("    ⚠ ") + message);
  },

  config(model: string, serverUrl: string): void {
    console.log(chalk.gray("  Model: ") + chalk.white(model));
    console.log(chalk.gray("  Server: ") + chalk.white(serverUrl));
  },

  task(task: string, method: string): void {
    console.log(chalk.gray("  Task: ") + chalk.white(task));
    console.log(chalk.gray("  Method: ") + chalk.white(method));
  },
};

export function printComparisonResults(
  screenshotResults: BenchmarkResult,
  webmcpResults: BenchmarkResult,
  title = "FINAL COMPARISON"
): void {
  cli.header(title);

  const table = new Table({
    head: [
      chalk.bold.white("Metric"),
      chalk.bold.white("Screenshot"),
      chalk.bold.white("WebMCP"),
      chalk.bold.white("Difference"),
    ],
    style: {
      head: [],
      border: ["cyan"],
    },
  });

  const inputDiff = screenshotResults.totalInputTokens - webmcpResults.totalInputTokens;
  const outputDiff = screenshotResults.totalOutputTokens - webmcpResults.totalOutputTokens;
  const totalDiff = screenshotResults.totalTokens - webmcpResults.totalTokens;

  const inputPct = ((inputDiff / screenshotResults.totalInputTokens) * 100).toFixed(1);
  const outputPct = ((outputDiff / screenshotResults.totalOutputTokens) * 100).toFixed(1);
  const totalPct = ((totalDiff / screenshotResults.totalTokens) * 100).toFixed(1);

  table.push(
    [
      "Input tokens",
      formatNumber(screenshotResults.totalInputTokens),
      formatNumber(webmcpResults.totalInputTokens),
      chalk.green(`${formatNumber(inputDiff)} (↓${inputPct}%)`),
    ],
    [
      "Output tokens",
      formatNumber(screenshotResults.totalOutputTokens),
      formatNumber(webmcpResults.totalOutputTokens),
      chalk.green(`${formatNumber(outputDiff)} (↓${outputPct}%)`),
    ],
    [
      chalk.bold("Total tokens"),
      chalk.bold(formatNumber(screenshotResults.totalTokens)),
      chalk.bold(formatNumber(webmcpResults.totalTokens)),
      chalk.bold.green(`${formatNumber(totalDiff)} (↓${totalPct}%)`),
    ],
    [
      "Image tokens",
      formatNumber(screenshotResults.imageTokens),
      "0",
      formatNumber(screenshotResults.imageTokens),
    ],
    [
      "Screenshots",
      String(screenshotResults.screenshotsTaken),
      "0",
      String(screenshotResults.screenshotsTaken),
    ]
  );

  if (webmcpResults.toolCallCount !== undefined) {
    table.push([
      "WebMCP tool calls",
      "0",
      String(webmcpResults.toolCallCount),
      "-",
    ]);
  }

  console.log(table.toString());

  console.log();
  console.log(
    chalk.bold.green(`  ✓ TOKEN REDUCTION: ${totalPct}%`)
  );
}

export function printCostAnalysis(
  screenshotResults: BenchmarkResult,
  webmcpResults: BenchmarkResult
): void {
  const screenshotCost =
    (screenshotResults.totalInputTokens / 1_000_000) * PRICING.inputPerMillion +
    (screenshotResults.totalOutputTokens / 1_000_000) * PRICING.outputPerMillion;

  const webmcpCost =
    (webmcpResults.totalInputTokens / 1_000_000) * PRICING.inputPerMillion +
    (webmcpResults.totalOutputTokens / 1_000_000) * PRICING.outputPerMillion;

  const savings = screenshotCost - webmcpCost;
  const savingsPct = ((savings / screenshotCost) * 100).toFixed(1);

  console.log();
  console.log(
    chalk.gray(
      `  Cost comparison (Sonnet: $${PRICING.inputPerMillion}/1M input, $${PRICING.outputPerMillion}/1M output):`
    )
  );
  console.log(
    chalk.gray("    Screenshot approach: ") + chalk.white(`$${screenshotCost.toFixed(6)}`)
  );
  console.log(
    chalk.gray("    WebMCP approach:     ") + chalk.white(`$${webmcpCost.toFixed(6)}`)
  );
  console.log(
    chalk.gray("    Savings per task:    ") +
      chalk.green(`$${savings.toFixed(6)} (${savingsPct}%)`)
  );

  console.log();
  console.log(chalk.gray("  Extrapolated to 100 interactions:"));
  console.log(
    chalk.gray("    Screenshot approach: ") + chalk.white(`$${(screenshotCost * 100).toFixed(4)}`)
  );
  console.log(
    chalk.gray("    WebMCP approach:     ") + chalk.white(`$${(webmcpCost * 100).toFixed(4)}`)
  );
  console.log(
    chalk.gray("    Savings:             ") +
      chalk.green(`$${(savings * 100).toFixed(4)}`)
  );
  console.log();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function aggregateBenchmarkResults(
  approach: string,
  results: AgentBenchmarkResult[]
): AggregatedBenchmarkResults {
  const n = results.length;
  if (n === 0) {
    return {
      approach,
      runs: [],
      avgInputTokens: 0,
      avgOutputTokens: 0,
      avgImageTokens: 0,
      avgTotalCostUsd: 0,
      avgDurationMs: 0,
      avgNumTurns: 0,
      successRate: 0,
    };
  }

  const sum = (key: keyof AgentBenchmarkResult) =>
    results.reduce((acc, r) => acc + (r[key] as number), 0);

  const totalToolUsage: Record<string, number> = {};
  for (const result of results) {
    if (result.toolUsage) {
      for (const [tool, count] of Object.entries(result.toolUsage)) {
        totalToolUsage[tool] = (totalToolUsage[tool] || 0) + count;
      }
    }
  }

  return {
    approach,
    runs: results,
    avgInputTokens: sum("inputTokens") / n,
    avgOutputTokens: sum("outputTokens") / n,
    avgImageTokens: sum("imageTokens") / n,
    avgTotalCostUsd: sum("totalCostUsd") / n,
    avgDurationMs: sum("durationMs") / n,
    avgNumTurns: sum("numTurns") / n,
    successRate: results.filter((r) => r.success).length / n,
    totalToolUsage:
      Object.keys(totalToolUsage).length > 0 ? totalToolUsage : undefined,
  };
}

/**
 * Prints formatted results for a single approach (Agent SDK version).
 *
 * @param results - Aggregated results for one approach
 */
export function printAgentApproachResults(
  results: AggregatedBenchmarkResults
): void {
  const table = new Table({
    head: [chalk.bold.white("Metric"), chalk.bold.white("Average")],
    style: { head: [], border: ["cyan"] },
    colWidths: [25, 25],
  });

  table.push(
    ["Input tokens", formatNumber(Math.round(results.avgInputTokens))],
    ["Output tokens", formatNumber(Math.round(results.avgOutputTokens))],
    ["Image tokens", formatNumber(Math.round(results.avgImageTokens))],
    ["Total cost", `$${results.avgTotalCostUsd.toFixed(4)}`],
    ["Duration", `${formatNumber(Math.round(results.avgDurationMs))}ms`],
    ["Turns", results.avgNumTurns.toFixed(1)],
    ["Success rate", `${(results.successRate * 100).toFixed(0)}%`]
  );

  console.log(table.toString());

  if (
    results.totalToolUsage &&
    Object.keys(results.totalToolUsage).length > 0
  ) {
    console.log();
    console.log(chalk.gray("  Tool usage (total across all runs):"));
    const sortedTools = Object.entries(results.totalToolUsage).sort(
      (a, b) => b[1] - a[1]
    );
    for (const [tool, count] of sortedTools) {
      const shortName = tool.replace("mcp__chrome-devtools__", "");
      console.log(
        chalk.gray(`    ${shortName}: `) + chalk.white(count.toString())
      );
    }
  }
}

/**
 * Prints a comparison table between two approaches (Agent SDK version).
 *
 * @param screenshot - Aggregated results for screenshot approach
 * @param webmcp - Aggregated results for WebMCP approach
 * @param title - Optional title for the comparison section
 */
export function printAgentComparisonResults(
  screenshot: AggregatedBenchmarkResults,
  webmcp: AggregatedBenchmarkResults,
  title = "COMPARISON"
): void {
  cli.header(title);

  const table = new Table({
    head: [
      chalk.bold.white("Metric"),
      chalk.bold.white("Screenshot"),
      chalk.bold.white("WebMCP"),
      chalk.bold.white("Difference"),
    ],
    style: { head: [], border: ["cyan"] },
  });

  const formatDiff = (
    ss: number,
    wm: number,
    isLowerBetter = true
  ): string => {
    const diff = ss - wm;
    const pct =
      ss > 0 ? ((diff / ss) * 100).toFixed(1) : "0.0";
    const arrow = diff > 0 ? "↓" : diff < 0 ? "↑" : "=";
    const color =
      (isLowerBetter ? diff > 0 : diff < 0) ? chalk.green : chalk.red;
    return color(
      `${formatNumber(Math.abs(Math.round(diff)))} (${arrow}${Math.abs(parseFloat(pct))}%)`
    );
  };

  table.push(
    [
      "Input tokens",
      formatNumber(Math.round(screenshot.avgInputTokens)),
      formatNumber(Math.round(webmcp.avgInputTokens)),
      formatDiff(screenshot.avgInputTokens, webmcp.avgInputTokens),
    ],
    [
      "Output tokens",
      formatNumber(Math.round(screenshot.avgOutputTokens)),
      formatNumber(Math.round(webmcp.avgOutputTokens)),
      formatDiff(screenshot.avgOutputTokens, webmcp.avgOutputTokens),
    ],
    [
      "Image tokens",
      formatNumber(Math.round(screenshot.avgImageTokens)),
      formatNumber(Math.round(webmcp.avgImageTokens)),
      formatDiff(screenshot.avgImageTokens, webmcp.avgImageTokens),
    ],
    [
      chalk.bold("Total cost"),
      `$${screenshot.avgTotalCostUsd.toFixed(4)}`,
      `$${webmcp.avgTotalCostUsd.toFixed(4)}`,
      formatDiff(screenshot.avgTotalCostUsd, webmcp.avgTotalCostUsd),
    ],
    [
      "Duration",
      `${formatNumber(Math.round(screenshot.avgDurationMs))}ms`,
      `${formatNumber(Math.round(webmcp.avgDurationMs))}ms`,
      formatDiff(screenshot.avgDurationMs, webmcp.avgDurationMs),
    ],
    [
      "Turns",
      screenshot.avgNumTurns.toFixed(1),
      webmcp.avgNumTurns.toFixed(1),
      formatDiff(screenshot.avgNumTurns, webmcp.avgNumTurns),
    ],
    [
      "Success rate",
      `${(screenshot.successRate * 100).toFixed(0)}%`,
      `${(webmcp.successRate * 100).toFixed(0)}%`,
      formatDiff(webmcp.successRate, screenshot.successRate, false), // Higher is better
    ]
  );

  console.log(table.toString());

  const tokenReduction =
    ((screenshot.avgInputTokens - webmcp.avgInputTokens) /
      screenshot.avgInputTokens) *
    100;
  const costReduction =
    ((screenshot.avgTotalCostUsd - webmcp.avgTotalCostUsd) /
      screenshot.avgTotalCostUsd) *
    100;

  console.log();
  if (tokenReduction > 0) {
    console.log(
      chalk.bold.green(`  ✓ TOKEN REDUCTION: ${tokenReduction.toFixed(1)}%`)
    );
  }
  if (costReduction > 0) {
    console.log(
      chalk.bold.green(`  ✓ COST REDUCTION: ${costReduction.toFixed(1)}%`)
    );
  }
}

/**
 * Prints detailed cost analysis with extrapolations (Agent SDK version).
 *
 * @param screenshot - Aggregated results for screenshot approach
 * @param webmcp - Aggregated results for WebMCP approach
 */
export function printAgentCostAnalysis(
  screenshot: AggregatedBenchmarkResults,
  webmcp: AggregatedBenchmarkResults
): void {
  const savings = screenshot.avgTotalCostUsd - webmcp.avgTotalCostUsd;
  const savingsPct =
    screenshot.avgTotalCostUsd > 0
      ? ((savings / screenshot.avgTotalCostUsd) * 100).toFixed(1)
      : "0.0";

  cli.section("COST ANALYSIS");

  console.log(chalk.gray("  Per task average:"));
  console.log(
    chalk.gray("    Screenshot approach: ") +
      chalk.white(`$${screenshot.avgTotalCostUsd.toFixed(6)}`)
  );
  console.log(
    chalk.gray("    WebMCP approach:     ") +
      chalk.white(`$${webmcp.avgTotalCostUsd.toFixed(6)}`)
  );
  console.log(
    chalk.gray("    Savings per task:    ") +
      chalk.green(`$${savings.toFixed(6)} (${savingsPct}%)`)
  );

  console.log();
  console.log(chalk.gray("  Extrapolated to 100 tasks:"));
  console.log(
    chalk.gray("    Screenshot approach: ") +
      chalk.white(`$${(screenshot.avgTotalCostUsd * 100).toFixed(4)}`)
  );
  console.log(
    chalk.gray("    WebMCP approach:     ") +
      chalk.white(`$${(webmcp.avgTotalCostUsd * 100).toFixed(4)}`)
  );
  console.log(
    chalk.gray("    Savings:             ") +
      chalk.green(`$${(savings * 100).toFixed(4)}`)
  );

  console.log();
  console.log(chalk.gray("  Extrapolated to 1,000 tasks:"));
  console.log(
    chalk.gray("    Screenshot approach: ") +
      chalk.white(`$${(screenshot.avgTotalCostUsd * 1000).toFixed(2)}`)
  );
  console.log(
    chalk.gray("    WebMCP approach:     ") +
      chalk.white(`$${(webmcp.avgTotalCostUsd * 1000).toFixed(2)}`)
  );
  console.log(
    chalk.gray("    Savings:             ") +
      chalk.green(`$${(savings * 1000).toFixed(2)}`)
  );
  console.log();
}
