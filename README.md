# Chrome DevTools MCP Quickstart

> Let AI agents interact with your website through Chrome DevTools Protocol + WebMCP tools.

This quickstart demonstrates how to use **[@mcp-b/chrome-devtools-mcp](https://www.npmjs.com/package/@mcp-b/chrome-devtools-mcp)** — a fork of Google's [Chrome DevTools MCP](https://github.com/AiDotNet/chromedevtools-mcp-server) with **WebMCP integration**. AI agents like Claude Code or Cursor can:

1. Navigate to your website
2. Discover your WebMCP tools via `list_webmcp_tools`
3. Call your tools via `call_webmcp_tool`
4. Interact with the page using 28+ browser automation tools

This creates a powerful development loop where AI can build, test, and iterate on browser-based tools in real-time.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Understanding the Example Tools](#understanding-the-example-tools)
- [Setting Up Chrome DevTools MCP](#setting-up-chrome-devtools-mcp)
  - [Claude Code](#claude-code)
  - [Cursor](#cursor)
  - [Claude Desktop](#claude-desktop)
  - [Windsurf](#windsurf)
  - [Other MCP Clients](#other-mcp-clients)
- [Testing Your Setup](#testing-your-setup)
- [Creating Your Own Tools](#creating-your-own-tools)
- [Available Browser Automation Tools](#available-browser-automation-tools)
- [Agent Integration Patterns](#agent-integration-patterns)
- [Troubleshooting](#troubleshooting)
- [Resources](#resources)

---

## Prerequisites

- **Node.js 18+** installed
- **Chrome browser** (or Chromium-based browser)
- An **MCP-compatible AI client** (Claude Code, Cursor, Claude Desktop, etc.)

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/WebMCP-org/chrome-devtools-quickstart.git
cd chrome-devtools-quickstart
npm install
```

### 2. Start the Dev Server

```bash
npm run dev
```

This starts a Vite dev server at `http://localhost:5173` (or similar port).

### 3. Add Chrome DevTools MCP to Your AI Client

**Claude Code (fastest):**
```bash
claude mcp add chrome-devtools npx @mcp-b/chrome-devtools-mcp@latest
```

**Cursor:** Add to `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@mcp-b/chrome-devtools-mcp@latest"]
    }
  }
}
```

### 4. Test It!

Ask your AI:

> "Navigate to http://localhost:5173, list available WebMCP tools, and call the get_counter tool"

The AI will:
1. Open Chrome and navigate to your page
2. Discover the registered tools (`get_page_title`, `get_counter`, `set_counter`)
3. Execute the tool and return the result

---

## How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   AI Client     │────▶│  Chrome DevTools │────▶│   Your Website  │
│ (Claude/Cursor) │     │       MCP        │     │  (with WebMCP)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        │  "call get_counter"    │   CDP Connection       │
        │───────────────────────▶│───────────────────────▶│
        │                        │                        │
        │                        │   navigator.modelContext
        │                        │   .tools["get_counter"]
        │                        │   .execute()           │
        │◀───────────────────────│◀───────────────────────│
        │    "counter is 5"      │                        │
```

1. **Your website** loads `@mcp-b/global` polyfill which adds `navigator.modelContext`
2. **You register tools** using `navigator.modelContext.registerTool()`
3. **Chrome DevTools MCP** connects to Chrome via Chrome DevTools Protocol
4. **AI agents** discover tools via `list_webmcp_tools` and call them via `call_webmcp_tool`

---

## Project Structure

```
chrome-devtools-quickstart/
├── index.html          # Entry point
├── main.js             # Imports polyfill and sets up app
├── counter.js          # Example WebMCP tools registered here
├── style.css           # Styling
├── package.json        # Dependencies (@mcp-b/global)
└── public/             # Static assets
```

---

## Understanding the Example Tools

This quickstart includes three example tools in `counter.js`:

### `get_page_title`
Returns the current page title.

```javascript
navigator.modelContext.registerTool({
  name: "get_page_title",
  description: "Get current page title",
  inputSchema: { type: "object", properties: {} },
  async execute() {
    return {
      content: [{ type: "text", text: document.title }]
    };
  }
});
```

### `get_counter`
Returns the current counter value.

```javascript
navigator.modelContext.registerTool({
  name: 'get_counter',
  description: 'Returns the current value of the counter',
  inputSchema: {
    type: 'object',
    properties: {}
  },
  async execute() {
    return {
      content: [{ type: 'text', text: `the current counter value is ${counter}` }]
    };
  }
});
```

### `set_counter`
Sets the counter to a specific value.

```javascript
navigator.modelContext.registerTool({
  name: 'set_counter',
  description: 'Sets the counter to the desired value',
  inputSchema: {
    type: 'object',
    properties: {
      newCounterValue: {
        type: 'number',
        description: 'The number you want to set the counter to'
      }
    },
    required: ['newCounterValue']
  },
  async execute(args) {
    setCounter(args.newCounterValue);
    return {
      content: [{ type: 'text', text: 'counter is now ' + args.newCounterValue }]
    };
  }
});
```

---

## Setting Up Chrome DevTools MCP

### Claude Code

**One-liner install:**
```bash
claude mcp add chrome-devtools npx @mcp-b/chrome-devtools-mcp@latest
```

**Or manually edit** `~/.config/claude/mcp.json` (macOS/Linux) or `%APPDATA%\claude\mcp.json` (Windows):

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@mcp-b/chrome-devtools-mcp@latest"]
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@mcp-b/chrome-devtools-mcp@latest"]
    }
  }
}
```

Restart Cursor after adding.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or the equivalent on Windows:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@mcp-b/chrome-devtools-mcp@latest"]
    }
  }
}
```

### Windsurf

Add to `mcp_config.json`:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["@mcp-b/chrome-devtools-mcp@latest"]
    }
  }
}
```

### Other MCP Clients

Any MCP-compatible client can use:
- **Command:** `npx`
- **Args:** `["@mcp-b/chrome-devtools-mcp@latest"]`

---

## Testing Your Setup

Once configured, try these prompts with your AI:

### Basic Navigation
> "Open Chrome, navigate to http://localhost:5173 and take a screenshot"

### Discover Tools
> "Navigate to http://localhost:5173 and list all available WebMCP tools"

### Call Tools
> "Navigate to http://localhost:5173, get the current counter value, then set it to 42"

### Full Development Loop
> "Navigate to my local dev server at http://localhost:5173, find the WebMCP tools, test them all, and tell me what each one does"

---

## Creating Your Own Tools

### Basic Tool Structure

```javascript
import '@mcp-b/global';  // Must be imported first!

navigator.modelContext.registerTool({
  name: "tool_name",           // Unique identifier (snake_case recommended)
  description: "What this tool does - be descriptive for AI understanding",
  inputSchema: {
    type: "object",
    properties: {
      paramName: {
        type: "string",        // string, number, boolean, array, object
        description: "What this parameter does"
      }
    },
    required: ["paramName"]    // Which params are required
  },
  async execute(args) {
    // Your tool logic here
    const result = doSomething(args.paramName);

    return {
      content: [{ type: "text", text: result }]
    };
  }
});
```

### Tool with Complex Schema

```javascript
navigator.modelContext.registerTool({
  name: "search_products",
  description: "Search for products by various criteria",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search query text",
        minLength: 1,
        maxLength: 100
      },
      category: {
        type: "string",
        enum: ["electronics", "clothing", "books", "home"],
        description: "Product category to filter by"
      },
      minPrice: {
        type: "number",
        minimum: 0,
        description: "Minimum price in dollars"
      },
      maxPrice: {
        type: "number",
        minimum: 0,
        description: "Maximum price in dollars"
      },
      limit: {
        type: "number",
        minimum: 1,
        maximum: 100,
        default: 10,
        description: "Maximum number of results"
      }
    },
    required: ["query"]
  },
  async execute({ query, category, minPrice, maxPrice, limit = 10 }) {
    const results = await searchProducts({ query, category, minPrice, maxPrice, limit });
    return {
      content: [{ type: "text", text: JSON.stringify(results) }]
    };
  }
});
```

### Unregistering Tools

```javascript
const registration = navigator.modelContext.registerTool({
  name: "temporary_tool",
  // ...
});

// Later, when you want to remove the tool:
registration.unregister();
```

### Tips for Writing Good Tools

1. **Be descriptive** - AI agents rely on descriptions to understand when to use tools
2. **Use snake_case** for tool names
3. **Validate inputs** - Use JSON Schema constraints (`minimum`, `maximum`, `enum`, etc.)
4. **Return meaningful text** - The AI needs to understand what happened
5. **Handle errors gracefully** - Return error messages, don't throw unhandled exceptions

---

## Available Browser Automation Tools

Chrome DevTools MCP includes 28+ browser automation tools beyond WebMCP:

### Navigation
| Tool | Description |
|------|-------------|
| `navigate_page` | Go to a URL |
| `go_back` / `go_forward` | Browser history navigation |
| `refresh` | Reload the current page |

### Interaction
| Tool | Description |
|------|-------------|
| `click` | Click on elements |
| `fill` | Enter text into inputs |
| `hover` | Mouse hover over elements |
| `press_key` | Press keyboard keys |

### Inspection
| Tool | Description |
|------|-------------|
| `take_screenshot` | Capture page or element |
| `take_snapshot` | Get accessibility tree snapshot |
| `evaluate_script` | Run JavaScript in page context |

### Tab Management
| Tool | Description |
|------|-------------|
| `list_pages` | See open tabs |
| `select_page` | Switch active tab |
| `new_page` / `close_page` | Manage tabs |

### WebMCP Integration
| Tool | Description |
|------|-------------|
| `list_webmcp_tools` | Discover tools registered on the page |
| `call_webmcp_tool` | Execute a WebMCP tool |

---

## Agent Integration Patterns

### TDD for AI (Test-Driven Development)

The most powerful pattern: AI writes code, tests it immediately, iterates until working.

```
┌──────────────┐
│ AI writes    │
│ tool code    │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ Dev server   │
│ hot-reloads  │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ AI navigates │
│ to page      │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ AI calls     │◀──┐
│ list_webmcp_ │   │
│ tools        │   │
└──────┬───────┘   │
       │           │
       ▼           │
┌──────────────┐   │
│ AI calls     │   │
│ call_webmcp_ │   │
│ tool         │   │
└──────┬───────┘   │
       │           │
       ▼           │
   ┌───────┐       │
   │Works? │───No──┘
   └───┬───┘
       │ Yes
       ▼
   ┌───────┐
   │ Done! │
   └───────┘
```

### Example Prompts for Development

**Building a new tool:**
> "Create a WebMCP tool called 'toggle_theme' that switches between light and dark mode on the page. Register it in counter.js, then navigate to the page and test it."

**Debugging an existing tool:**
> "Navigate to http://localhost:5173, list the WebMCP tools, call set_counter with value 100, then call get_counter to verify it worked."

**Building and testing a feature:**
> "I need a tool that can add items to a shopping cart. Write the tool, add it to the page, and test it by adding 3 items."

### Alternative: MCP-B Extension

For **production** websites or when you don't want to use Chrome DevTools MCP, consider the [MCP-B Extension](https://chromewebstore.google.com/detail/mcp-b-extension/daohopfhkdelnpemnhlekblnikhdhfa):

1. Install the extension from Chrome Web Store
2. Set up the [Native Host](https://docs.mcp-b.ai/native-host-setup) for Claude Desktop/Claude Code
3. Your tools are automatically discovered on any page you visit

This is better for:
- Testing on production sites
- Using tools without running MCP server
- Aggregating tools from multiple tabs

---

## Troubleshooting

### "No WebMCP tools found"

1. **Check polyfill is loaded:** Open browser console and run `navigator.modelContext` - should not be `undefined`
2. **Check tools are registered:** Run `navigator.modelContext.tools` or check the MCP-B extension "Tools" tab
3. **Page fully loaded:** Wait for page to finish loading before calling `list_webmcp_tools`

### "Chrome DevTools MCP can't connect"

1. **Chrome must be running:** The MCP server connects to an existing Chrome instance
2. **Enable remote debugging:** Chrome may need `--remote-debugging-port=9222` flag
3. **Check firewall:** Ensure localhost connections aren't blocked

### "Tool execution failed"

1. **Check browser console:** Look for JavaScript errors
2. **Verify input schema:** Make sure you're passing correct parameter types
3. **Check tool is still registered:** Hot reloads may temporarily unregister tools

### Common Errors

| Error | Solution |
|-------|----------|
| `navigator.modelContext is undefined` | Add `@mcp-b/global` import before any tool registration |
| `Tool not found` | Ensure the page has fully loaded and tool is registered |
| `Invalid arguments` | Check inputSchema matches the arguments you're passing |

---

## Resources

- **WebMCP Documentation:** https://docs.mcp-b.ai
- **Chrome DevTools MCP Package:** https://www.npmjs.com/package/@mcp-b/chrome-devtools-mcp
- **@mcp-b/global Package:** https://www.npmjs.com/package/@mcp-b/global
- **MCP-B Extension:** [Chrome Web Store](https://chromewebstore.google.com/detail/mcp-b-extension/daohopfhkdelnpemnhlekblnikhdhfa)
- **Examples Repository:** https://github.com/WebMCP-org/examples
- **Discord Community:** https://discord.gg/webmcp

---

## License

MIT

---

Built with [WebMCP](https://docs.mcp-b.ai) and [Chrome DevTools MCP](https://github.com/AiDotNet/chromedevtools-mcp-server)
