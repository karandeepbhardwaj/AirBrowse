# AirBrowse - Architecture

## Overview

AirBrowse connects GitHub Copilot's AI capabilities directly to browser automation. It consists of two components -- a VS Code extension and a Chrome extension -- bridged by a WebSocket relay on localhost.

## System Diagram

```
+-------------------------------------------------+
|                    VS Code                       |
|                                                  |
|  +-------------------------------------------+  |
|  |          GitHub Copilot Chat               |  |
|  |  (Agent Mode / @browse Participant)        |  |
|  +----+----------------------------------+----+  |
|       |                                  |       |
|       v                                  v       |
|  +-----------+    +-----------+   +----------+   |
|  | navigate  |    | page_text |   | crawl    |   |
|  | click     |    | screenshot|   | generate |   |
|  | type_text |    | console   |   | ...      |   |
|  +-----------+    +-----------+   +----------+   |
|       |                |               |         |
|       +-------+--------+-------+-------+         |
|               |                                  |
|               v                                  |
|  +-------------------------+                     |
|  |      RelayClient        |                     |
|  | (WebSocket connection)  |                     |
|  +----------+--------------+                     |
+-----------  |  ------------------ ---------------+
              |
              |  ws://localhost:8765
              |
+----------   |  ----------------------------------+
|             v                                     |
|  +-------------------------+                      |
|  |     Relay Server        |                      |
|  |  (WebSocket hub)        |                      |
|  +----------+--------------+                      |
|             |                                     |
|             v                                     |
|  +-------------------------+        Chrome        |
|  |   background.js         |                      |
|  |   (Service Worker)      |                      |
|  +----------+--------------+                      |
|             |                                     |
|             v                                     |
|  +-------------------------+                      |
|  |    content.js           |                      |
|  |  (DOM operations)       |                      |
|  +-------------------------+                      |
|                                                   |
|  +-------------------------+                      |
|  |   crawl-manager.js      |                      |
|  |  (Multi-page crawling)  |                      |
|  +-------------------------+                      |
+---------------------------------------------------+
```

## Message Flow

1. **User asks Copilot** to perform a browser task (e.g., "get the text from this page")
2. **Copilot selects a tool** from AirBrowse's registered Language Model Tools
3. **Tool executes**, calling `RelayClient.sendCommand()` with a command type and payload
4. **RelayClient** sends a JSON message over WebSocket to the relay server
5. **Relay server** forwards the message to the connected Chrome extension
6. **Chrome background.js** receives the command and dispatches it to the active tab's content script
7. **content.js** performs the DOM operation and returns the result
8. **Result flows back** through the relay to the VS Code tool, which formats it for Copilot

Each message carries a unique `id` so responses can be correlated with requests.

## Tool Registration

Tools are registered with Copilot's Language Model Tools API (`vscode.lm.registerTool`). Each tool:

- Extends `BaseBrowserTool`
- Declares a `name`, `description`, and JSON Schema `inputSchema`
- Implements `execute()` which calls `RelayClient.sendCommand()`

Tools are also available through the `@browse` Chat Participant, which maps natural language to tool invocations using Copilot's language model.

## Agent Loop

In Agent Mode, Copilot orchestrates multi-step workflows automatically:

1. Copilot analyzes the user's request
2. Selects and calls one or more AirBrowse tools
3. Reads the tool results
4. Decides whether more actions are needed
5. Repeats until the task is complete
6. Summarizes the results to the user

This allows complex tasks like "navigate to a site, find a table, and export it as Excel" to be handled in a single conversation turn.

## Crawl Engine

The crawl engine (`crawl-manager.js` in the Chrome extension) handles multi-page operations:

1. Starts from a seed URL
2. Discovers links on the page matching configurable patterns
3. Visits each link, collecting content
4. Respects depth limits and domain boundaries
5. Streams results back to VS Code as pages are processed

The VS Code side (`crawl-site.tool.ts`) coordinates the crawl and can feed results into file generators.

## File Generators

Generators in `src/generators/` convert collected data into output files:

| Generator | Output | Library |
|-----------|--------|---------|
| `xlsx.ts` | Excel spreadsheets | ExcelJS |
| `docx.ts` | Word documents | docx |
| `csv.ts`  | CSV files | Built-in |
| `markdown.ts` | Markdown files | Built-in |

Generated files are saved to the workspace and opened in VS Code automatically.
