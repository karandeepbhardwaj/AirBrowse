# AirBrowse Agent — Browser Automation Powered by GitHub Copilot's Native Models

## Complete Build Plan for Claude Code

---

## 1. Executive Summary

**AirBrowse** is a VS Code extension + Chrome extension that gives enterprise users on restricted/air-gapped machines the ability to crawl websites, summarize documentation, extract data into files (Excel, Word, CSV), and automate UI testing — **using only GitHub Copilot's built-in models** via the `vscode.lm` API. No Ollama, no local models, no additional AI infrastructure.

### The Key Constraint & Insight

Air-gapped enterprise machines:
- ❌ Cannot run local models (no GPU, no Ollama, no vLLM)
- ❌ Cannot access arbitrary cloud APIs
- ✅ **DO have GitHub Copilot** — enterprise IT has allowlisted Copilot's endpoints (`*.githubcopilot.com`, `*.individual.githubcopilot.com`, etc.) through a proxy/firewall
- ✅ VS Code's `vscode.lm` API lets extensions tap into whatever model the user has selected in Copilot's model picker (GPT-4o, Claude Sonnet, o1, etc.)
- ✅ VS Code's `vscode.lm.registerTool` API lets us register browser automation tools that Copilot's Agent Mode can call natively
- ✅ Chrome extensions work fully offline on the local machine (intranet browsing)

**This means Copilot IS the LLM.** We don't bring our own — we register tools and a chat participant that leverage whatever Copilot model is already available and authenticated.

### Two Integration Approaches (Both Built)

**Approach A — Language Model Tools (Primary, Recommended)**
Register browser tools via `vscode.lm.registerTool()`. These appear in Copilot's Agent Mode automatically. The user types in the normal Copilot Chat: *"crawl the wiki and make me a summary"* — and Copilot's own agent loop calls our tools.

**Approach B — Chat Participant (`@browse`)**
Register a `@browse` chat participant via `vscode.chat.createChatParticipant()`. The participant receives the user's prompt, calls `vscode.lm.selectChatModels()` to get Copilot's active model, sends custom prompts with page content, and streams results back. This gives us more control over the agent loop when we need multi-step orchestration.

### Existing Solutions That Informed This Design

| Project | What We Borrow |
|---|---|
| **jaypal1046/copilot-browser** | WebSocket relay architecture: Chrome ext ↔ Relay ↔ VS Code ext |
| **hangwin/mcp-chrome** | 20+ browser tool definitions as a reference taxonomy |
| **browser-use** (Python) | Agent loop pattern: observe → plan → act → verify |
| **VS Code Language Model Tool API docs** | `vscode.lm.registerTool` + `inputSchema` pattern for Agent Mode |
| **VS Code Chat Participant API docs** | `vscode.chat.createChatParticipant` + `sendChatParticipantRequest` with tools |
| **eclipsesource.com "Domain-specific AI Extensions" (Mar 2026)** | Modern pattern combining tools + participants + `vscode.lm` |

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                    USER'S MACHINE (Restricted Network)                  │
│                                                                        │
│  ┌──────────────────────────────────────────────────┐                  │
│  │              VS Code                              │                  │
│  │                                                   │                  │
│  │  ┌─────────────────────┐                          │                  │
│  │  │  GitHub Copilot      │ ◄── Models via proxy ──►│── github.com ──►│
│  │  │  (already installed) │     to Copilot servers   │  (allowlisted) │
│  │  │                     │                          │                  │
│  │  │  vscode.lm API      │                          │                  │
│  │  │  - selectChatModels │                          │                  │
│  │  │  - sendRequest      │                          │                  │
│  │  │  - registerTool     │                          │                  │
│  │  └──────────▲──────────┘                          │                  │
│  │             │ uses model                           │                  │
│  │  ┌──────────┴──────────┐     ┌──────────────┐     │                  │
│  │  │  AirBrowse Extension │◄───►│ Relay Server │     │                  │
│  │  │                     │ WS  │ (child proc) │     │                  │
│  │  │  - @browse chat part│     │ localhost:8765│     │                  │
│  │  │  - Registered tools │     └──────┬───────┘     │                  │
│  │  │  - File generators  │            │ WS          │                  │
│  │  └─────────────────────┘            │              │                  │
│  └──────────────────────────────────────┼──────────────┘                  │
│                                         │                                │
│  ┌──────────────────────────────────────┼──────────────┐                  │
│  │              Chrome Browser           │              │                  │
│  │                                       ▼              │                  │
│  │  ┌─────────────────────────────────────────────┐    │                  │
│  │  │  AirBrowse Chrome Extension                  │    │                  │
│  │  │  - Content Script (DOM extraction, actions)  │    │                  │
│  │  │  - Background Worker (WS client, routing)    │    │                  │
│  │  │  - Crawl Engine (multi-page, same-domain)    │    │                  │
│  │  │  - Readability.js + Turndown.js (bundled)    │    │                  │
│  │  └─────────────────────────────────────────────┘    │                  │
│  │                                                      │                  │
│  │  Browses intranet sites (no internet needed)         │                  │
│  └──────────────────────────────────────────────────────┘                  │
└────────────────────────────────────────────────────────────────────────┘
```

### Why This Works on Air-Gapped Machines

The machine is "air-gapped" from the general internet but **Copilot traffic is explicitly allowlisted**. GitHub documents specific URLs that must be reachable for Copilot to function. Enterprise IT has already done this — otherwise Copilot wouldn't work at all. Our extension adds zero new network requirements. It only uses:

1. `vscode.lm` API → which routes through Copilot's existing authenticated connection
2. `localhost` WebSocket → Chrome extension communication (purely local)
3. Chrome's normal browsing → intranet pages (already accessible)

---

## 3. How the Two Approaches Work

### Approach A: Language Model Tools (Copilot Agent Mode)

This is the cleanest integration. We register tools that Copilot's Agent Mode discovers and calls autonomously.

```typescript
// In package.json contributes:
"languageModelTools": [
  {
    "name": "airbrowse_getPageText",
    "displayName": "Get Page Text",
    "description": "Extract clean readable text from the current browser page. 
      Use this when you need to read, summarize, or analyze web page content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "selector": {
          "type": "string",
          "description": "Optional CSS selector to scope extraction. 
            Omit for full page."
        }
      }
    },
    "tags": ["airbrowse"]
  }
]

// In extension.ts:
class GetPageTextTool implements vscode.LanguageModelTool<{selector?: string}> {
  async invoke(options, token) {
    const result = await relayClient.sendCommand('page.getText', {
      selector: options.input.selector
    });
    return new vscode.LanguageModelToolResult([
      new vscode.LanguageModelTextPart(result.text)
    ]);
  }
  
  async prepareInvocation(options, token) {
    return {
      invocationMessage: 'Reading page content...',
      confirmationMessages: {
        title: 'Read Page Content',
        message: new vscode.MarkdownString(
          `Extract text from the current browser page` +
          (options.input.selector ? ` (selector: \`${options.input.selector}\`)` : '')
        )
      }
    };
  }
}

// Registration:
vscode.lm.registerTool('airbrowse_getPageText', new GetPageTextTool());
```

**User experience:** The user goes to Copilot Chat → Agent Mode → types: *"Read the current page and create an Excel file with all the table data"* → Copilot's LLM sees our registered tools → calls `airbrowse_getPageText`, then `airbrowse_getPageTables` → reasons about the data → calls a file-write tool → done.

### Approach B: Chat Participant (`@browse`)

For complex multi-step tasks where we need to control the agent loop ourselves.

```typescript
const handler: vscode.ChatRequestHandler = async (request, context, stream, token) => {
  // Use whatever model the user has selected in Copilot's model picker
  const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  if (!model) {
    stream.markdown('No Copilot model available. Please ensure GitHub Copilot is signed in.');
    return;
  }

  stream.progress('Connecting to browser...');
  
  // Step 1: Get page content via Chrome extension
  const pageContent = await relayClient.sendCommand('page.getMarkdown', {});
  
  // Step 2: Send to Copilot's model with our custom prompt
  const messages = [
    vscode.LanguageModelChatMessage.User(
      `You are a browser automation assistant. The user is viewing a web page. 
       Here is the page content:\n\n${pageContent.markdown}\n\n
       User request: ${request.prompt}\n\n
       Respond with your analysis. If the user wants a file, output structured 
       data as JSON wrapped in \`\`\`json code blocks.`
    )
  ];

  const response = await model.sendRequest(messages, {}, token);
  
  // Step 3: Stream response and parse for file generation
  let fullResponse = '';
  for await (const fragment of response.text) {
    stream.markdown(fragment);
    fullResponse += fragment;
  }
  
  // Step 4: If response contains JSON data, offer to generate files
  if (fullResponse.includes('```json')) {
    stream.button({
      command: 'airbrowse.generateExcel',
      title: 'Export as Excel'
    });
    stream.button({
      command: 'airbrowse.generateCSV', 
      title: 'Export as CSV'
    });
  }
};

vscode.chat.createChatParticipant('airbrowse.browse', handler);
```

**User experience:** User types `@browse summarize this documentation site and create a Word doc` → our participant takes over → crawls pages → feeds content to Copilot's model → generates the .docx file.

---

## 4. Complete Tool Registry

These tools are registered via `vscode.lm.registerTool()` so Copilot Agent Mode can call them:

### Page Reading Tools
| Tool Name | Description | Input Schema |
|---|---|---|
| `airbrowse_getPageText` | Extract clean article text via Readability | `{selector?: string}` |
| `airbrowse_getPageMarkdown` | Convert page to Markdown via Turndown | `{selector?: string}` |
| `airbrowse_getPageHTML` | Get raw HTML of page or element | `{selector?: string}` |
| `airbrowse_getPageTables` | Extract all tables as JSON arrays | `{selector?: string}` |
| `airbrowse_getPageLinks` | Get all links with text and href | `{selector?: string, sameDomain?: boolean}` |
| `airbrowse_getPageStructure` | Get heading outline (h1-h6 tree) | `{}` |
| `airbrowse_screenshot` | Capture visible page as base64 PNG | `{fullPage?: boolean}` |

### Navigation Tools
| Tool Name | Description | Input Schema |
|---|---|---|
| `airbrowse_navigateTo` | Navigate browser to a URL | `{url: string}` |
| `airbrowse_navigateBack` | Go back in browser history | `{}` |
| `airbrowse_getCurrentUrl` | Get current page URL and title | `{}` |

### Interaction Tools
| Tool Name | Description | Input Schema |
|---|---|---|
| `airbrowse_click` | Click an element | `{selector: string}` |
| `airbrowse_type` | Type text into an input field | `{selector: string, text: string}` |
| `airbrowse_selectOption` | Select a dropdown option | `{selector: string, value: string}` |
| `airbrowse_submitForm` | Submit a form | `{selector: string}` |
| `airbrowse_scrollTo` | Scroll to element or position | `{selector?: string, y?: number}` |

### Crawling Tools
| Tool Name | Description | Input Schema |
|---|---|---|
| `airbrowse_crawlSite` | Multi-page crawl (same domain) | `{startUrl: string, maxDepth?: number, maxPages?: number}` |
| `airbrowse_crawlCancel` | Cancel an active crawl | `{}` |

### Monitoring Tools
| Tool Name | Description | Input Schema |
|---|---|---|
| `airbrowse_getConsoleLogs` | Get browser console output | `{level?: "log"\|"warn"\|"error"}` |
| `airbrowse_getNetworkRequests` | Get recent network requests | `{filter?: string}` |

### File Generation Tools
| Tool Name | Description | Input Schema |
|---|---|---|
| `airbrowse_generateExcel` | Create .xlsx from structured data | `{sheets: [{name, headers, rows}]}` |
| `airbrowse_generateCSV` | Create .csv file | `{headers: string[], rows: string[][]}` |
| `airbrowse_generateWord` | Create .docx document | `{title, sections: [{heading, content}]}` |
| `airbrowse_generateMarkdown` | Create .md file | `{title, content}` |

---

## 5. Component Breakdown

### Component 1: Chrome Extension (`browser-extension/`)

Identical to the previous plan — this is purely local, no LLM dependency.

**Key Files:**
- `manifest.json` — Manifest V3, permissions: activeTab, scripting, storage, tabs
- `background.js` — Service worker, WebSocket client to `ws://localhost:8765`
- `content.js` — Injected into pages, handles all DOM operations
- `crawl-manager.js` — BFS crawl engine (same-domain, rate-limited, depth-limited)
- `lib/readability.js` — Mozilla Readability (bundled offline)
- `lib/turndown.js` — HTML→Markdown converter (bundled offline)
- `popup/` — Connection status UI

### Component 2: Relay Server (embedded in VS Code ext)

**Simplified:** Instead of a separate Node.js process, the relay server runs as a child process spawned by the VS Code extension. This keeps deployment simple — one `.vsix` file contains everything.

```typescript
// In extension activation:
const relayProcess = cp.fork(
  path.join(context.extensionPath, 'relay', 'server.js'),
  ['--port', '8765']
);
```

**Key behavior:**
- WebSocket server on `localhost:8765`
- Routes messages between VS Code extension (in-process) and Chrome extension (WS client)
- Request-response correlation via message IDs
- Sequential command execution queue (prevents race conditions)

### Component 3: VS Code Extension (`vscode-extension/`)

**The heart of the system.** Registers tools, chat participant, and file generators.

```
vscode-extension/
├── package.json                 # Extension manifest
├── tsconfig.json
├── src/
│   ├── extension.ts             # Activation, registration
│   ├── relay/
│   │   ├── server.ts            # WebSocket relay (spawned as child)
│   │   └── client.ts            # In-process relay client
│   ├── tools/                   # One class per registered tool
│   │   ├── page-text.tool.ts    # implements vscode.LanguageModelTool
│   │   ├── page-tables.tool.ts
│   │   ├── page-links.tool.ts
│   │   ├── page-markdown.tool.ts
│   │   ├── page-screenshot.tool.ts
│   │   ├── navigate.tool.ts
│   │   ├── interact-click.tool.ts
│   │   ├── interact-type.tool.ts
│   │   ├── crawl-site.tool.ts
│   │   ├── console-logs.tool.ts
│   │   ├── generate-excel.tool.ts
│   │   ├── generate-csv.tool.ts
│   │   ├── generate-word.tool.ts
│   │   └── index.ts             # Registers all tools
│   ├── participant/
│   │   ├── browse-handler.ts    # @browse chat participant
│   │   ├── prompts.ts           # System prompts for different tasks
│   │   └── agent-loop.ts        # Multi-step orchestration
│   ├── generators/
│   │   ├── xlsx.ts              # ExcelJS
│   │   ├── docx.ts              # docx library
│   │   ├── csv.ts
│   │   └── markdown.ts
│   └── utils/
│       ├── chunker.ts           # Split large content for context limits
│       └── logger.ts
├── relay/
│   └── server.js                # Standalone relay server script
└── test/
```

---

## 6. Agent Loop (Chat Participant Multi-Step)

When the user needs complex multi-step tasks (e.g., "crawl 10 pages, combine, summarize, make Excel"), the `@browse` participant runs its own agent loop using Copilot's model:

```typescript
async function agentLoop(
  request: vscode.ChatRequest,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) {
  const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot' });
  const conversationHistory: vscode.LanguageModelChatMessage[] = [];
  
  // System instructions
  conversationHistory.push(
    vscode.LanguageModelChatMessage.User(SYSTEM_PROMPT)
  );
  conversationHistory.push(
    vscode.LanguageModelChatMessage.User(request.prompt)
  );

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    if (token.isCancellationRequested) break;

    const response = await model.sendRequest(conversationHistory, {}, token);
    let fullText = '';
    for await (const fragment of response.text) {
      fullText += fragment;
    }

    // Parse LLM response for action commands (JSON blocks)
    const actions = parseActions(fullText);
    
    if (actions.length === 0) {
      // No more actions = task complete, stream final response
      stream.markdown(fullText);
      break;
    }

    // Execute each action via relay
    for (const action of actions) {
      stream.progress(`Executing: ${action.tool}...`);
      const result = await relayClient.sendCommand(action.tool, action.params);
      
      // Feed result back to LLM
      conversationHistory.push(
        vscode.LanguageModelChatMessage.Assistant(fullText)
      );
      conversationHistory.push(
        vscode.LanguageModelChatMessage.User(
          `Tool "${action.tool}" returned:\n${truncate(JSON.stringify(result), 8000)}`
        )
      );
    }
  }
}
```

**Why this works without tool-calling API support:**
The `vscode.lm.sendRequest` API doesn't support OpenAI-style `tools` parameter directly in the raw message flow. So for the chat participant's internal agent loop, we use a **prompt-driven approach**: instruct the LLM to output structured JSON action blocks, parse them ourselves, execute them, and feed results back. This works reliably with GPT-4o and Claude models.

The registered `vscode.lm.registerTool` tools, on the other hand, ARE automatically invoked by Copilot's Agent Mode — that's the native path where Copilot handles the tool-calling loop itself.

---

## 7. Use Cases & Workflows

### Use Case 1: Crawl & Summarize (Agent Mode — automatic)

User in Copilot Chat (Agent Mode):
> Crawl the documentation at http://internal-wiki/api-docs, then create a summary Word document

**Copilot sees our tools and autonomously:**
1. Calls `airbrowse_crawlSite({startUrl: "http://internal-wiki/api-docs", maxDepth: 2})`
2. Receives combined markdown content
3. Reasons about the content using its model
4. Calls `airbrowse_generateWord({title: "API Docs Summary", sections: [...]})`
5. Returns: "I've created the summary document at ./api-docs-summary.docx"

### Use Case 2: Extract Data → Excel (Agent Mode)

User:
> Go to the inventory page and extract all tables into an Excel file

**Copilot autonomously:**
1. Calls `airbrowse_navigateTo({url: "http://intranet/inventory"})`
2. Calls `airbrowse_getPageTables({})`
3. Calls `airbrowse_generateExcel({sheets: [{name: "Inventory", headers: [...], rows: [...]}]})`

### Use Case 3: UI Testing (`@browse` participant)

User:
> @browse test this login flow:
> 1. Go to localhost:3000/login
> 2. Type "admin" in #username  
> 3. Type "password123" in #password
> 4. Click the Login button
> 5. Verify the page says "Welcome"

**@browse participant:**
1. Parses the numbered steps
2. Executes each via relay commands
3. Takes screenshots after each step
4. Sends final state to Copilot's model: "Here's what happened at each step. Did the test pass?"
5. Streams a test report with pass/fail for each step

### Use Case 4: Ask Questions About a Page (`@browse` participant)

User:
> @browse what are the main arguments in this article?

**@browse participant:**
1. Extracts page content via `page.getMarkdown`
2. Sends to Copilot model with analysis prompt
3. Streams the analysis directly

---

## 8. File Structure for Claude Code

```
airbrowse/
├── browser-extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── crawl-manager.js
│   ├── tools/
│   │   ├── page-text.js
│   │   ├── page-tables.js
│   │   ├── page-links.js
│   │   ├── page-screenshot.js
│   │   ├── interact.js
│   │   ├── navigate.js
│   │   └── monitor.js
│   ├── lib/
│   │   ├── readability.js          # Bundled, no network needed
│   │   └── turndown.js             # Bundled, no network needed
│   ├── popup/
│   │   ├── popup.html
│   │   ├── popup.js
│   │   └── popup.css
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── vscode-extension/
│   ├── package.json                 # contributes: tools, chatParticipants, commands
│   ├── tsconfig.json
│   ├── webpack.config.js
│   ├── src/
│   │   ├── extension.ts
│   │   ├── relay/
│   │   │   ├── server.ts           # WebSocket relay (child process)
│   │   │   └── client.ts           # In-process client
│   │   ├── tools/
│   │   │   ├── base-tool.ts        # Abstract base class
│   │   │   ├── page-text.tool.ts
│   │   │   ├── page-markdown.tool.ts
│   │   │   ├── page-tables.tool.ts
│   │   │   ├── page-links.tool.ts
│   │   │   ├── page-screenshot.tool.ts
│   │   │   ├── page-structure.tool.ts
│   │   │   ├── navigate-to.tool.ts
│   │   │   ├── navigate-back.tool.ts
│   │   │   ├── get-url.tool.ts
│   │   │   ├── click.tool.ts
│   │   │   ├── type-text.tool.ts
│   │   │   ├── select-option.tool.ts
│   │   │   ├── submit-form.tool.ts
│   │   │   ├── scroll.tool.ts
│   │   │   ├── crawl-site.tool.ts
│   │   │   ├── console-logs.tool.ts
│   │   │   ├── network-requests.tool.ts
│   │   │   ├── generate-excel.tool.ts
│   │   │   ├── generate-csv.tool.ts
│   │   │   ├── generate-word.tool.ts
│   │   │   ├── generate-markdown.tool.ts
│   │   │   └── index.ts            # registerAllTools()
│   │   ├── participant/
│   │   │   ├── browse-handler.ts   # @browse chat participant
│   │   │   ├── agent-loop.ts       # Multi-step orchestration
│   │   │   ├── instruction-parser.ts  # Parse numbered test steps
│   │   │   └── prompts.ts          # System prompts per task type
│   │   ├── generators/
│   │   │   ├── xlsx.ts
│   │   │   ├── docx.ts
│   │   │   ├── csv.ts
│   │   │   └── markdown.ts
│   │   └── utils/
│   │       ├── chunker.ts          # Context window management
│   │       └── logger.ts
│   ├── relay/
│   │   └── server.js               # Standalone relay script
│   └── test/
├── scripts/
│   ├── package-all.js              # Build everything for deployment
│   └── package-extension.sh        # Build .vsix + Chrome .zip
├── docs/
│   ├── SETUP.md
│   ├── DEPLOYMENT.md               # How to deploy on restricted machines
│   └── ARCHITECTURE.md
├── .github/
│   └── copilot-instructions.md     # Context for Copilot-assisted development
├── package.json                     # Root workspace
├── LICENSE
└── README.md
```

---

## 9. Claude Code Implementation Agents (Ordered)

### Agent 1: Project Scaffolding + Relay Server

```
Create the airbrowse project:

1. Root package.json as an npm workspace with browser-extension/ and vscode-extension/

2. vscode-extension/relay/server.ts:
   - WebSocket server using the 'ws' library on localhost:8765
   - Accepts two client types: 'vscode' (in-process) and 'browser' (Chrome ext)
   - Message protocol: {id: uuid, type: 'command'|'response'|'event', 
     from: 'vscode'|'browser', action: string, params: object, 
     result: any, error: string|null}
   - Request-response correlation via message ID
   - Sequential command queue (execute one browser command at a time)
   - Heartbeat every 30s
   - Designed to be spawned as child_process.fork() from VS Code extension

3. vscode-extension/src/relay/client.ts:
   - TypeScript class RelayClient
   - sendCommand(action: string, params: object): Promise<any>
   - Uses in-process message passing when relay is forked child
   - Falls back to WebSocket when relay runs standalone
   - Event emitter for 'connected', 'disconnected', 'event'
   - Auto-reconnect with exponential backoff
   - 30s command timeout with AbortController

4. Include error handling, logging via VS Code OutputChannel
```

### Agent 2: Chrome Extension — Core Tools

```
Build browser-extension/ as a Chrome Manifest V3 extension:

1. manifest.json:
   - manifest_version: 3
   - permissions: ["activeTab", "scripting", "storage", "tabs"]
   - host_permissions: ["<all_urls>"] (needed for intranet)
   - background: {service_worker: "background.js"}
   - content_scripts: [{matches: ["<all_urls>"], js: ["content.js"]}]

2. background.js:
   - WebSocket client connecting to ws://localhost:8765
   - Identifies as client type 'browser' on connect
   - Routes incoming commands to content script via chrome.tabs.sendMessage
   - Routes responses back through WebSocket
   - Reconnection with exponential backoff (1s, 2s, 4s... max 30s)
   - chrome.runtime.onMessage listener for content script responses

3. content.js — implement these tool handlers:
   
   page.getText: 
     - Clone document.body, pass to bundled Readability.js
     - Return {title, text, excerpt, byline}
     - Falls back to document.body.innerText if Readability fails
   
   page.getMarkdown:
     - Use bundled Turndown.js on document.body or scoped element
     - Configure: headingStyle: 'atx', codeBlockStyle: 'fenced'
     - Return {markdown: string, wordCount: number}
   
   page.getHTML:
     - If selector: querySelector(selector).outerHTML
     - Else: document.documentElement.outerHTML
     - Return {html: string, length: number}
   
   page.getTables:
     - querySelectorAll('table')
     - For each: extract headers from <th>, rows from <td>
     - Return {tables: [{headers: string[], rows: string[][]}]}
   
   page.getLinks:
     - querySelectorAll('a[href]')
     - Map to {text, href, isInternal: sameOrigin check}
     - Optional sameDomain filter
     - Return {links: [{text, href, isInternal}]}
   
   page.getStructure:
     - querySelectorAll('h1,h2,h3,h4,h5,h6')
     - Build tree structure with {level, text, id}
     - Return {headings: [{level, text, id, children}]}
   
   page.screenshot:
     - chrome.tabs.captureVisibleTab from background.js
     - Return {dataUrl: string, width, height}
   
   navigate.goto:
     - window.location.href = url
     - Wait for load event, return {url, title}
   
   interact.click:
     - querySelector(selector), focus(), click()
     - Return {success: boolean, elementTag, elementText}
   
   interact.type:
     - querySelector(selector), focus()
     - Set value property
     - Dispatch 'input' and 'change' events
     - Return {success: boolean}
   
   monitor.console:
     - On init: monkey-patch console.log/warn/error to buffer
     - On request: return buffered entries with timestamp and level
     - Clear buffer after retrieval

4. Bundle lib/readability.js and lib/turndown.js from npm packages
   (download once, include in extension — fully offline)

5. popup/ — minimal HTML/CSS/JS showing:
   - Connection status (green/red circle)
   - Current page URL
   - Last executed command
   - Manual "Reconnect" button
```

### Agent 3: Chrome Extension — Crawl Engine

```
Add crawl-manager.js to browser-extension/:

1. CrawlManager class:
   - constructor({maxDepth: 2, maxPages: 50, sameDomainOnly: true, 
     delayMs: 1000})
   
   - async startCrawl(startUrl):
     * BFS queue initialized with startUrl at depth 0
     * visited = new Set()
     * results = new Map()
     * For each URL in queue:
       - Skip if visited, skip if different domain (when sameDomainOnly)
       - Navigate to URL (window.location or chrome.tabs.update)
       - Wait for page load (document.readyState === 'complete')
       - Extract: title, text (Readability), markdown (Turndown), 
         tables, links
       - Add same-domain links to queue at depth+1
       - Store in results Map
       - Send progress event: {visited: N, queued: M, current: url}
       - Wait delayMs between requests
     * Return aggregated results as {pages: [{url, title, text, 
       markdown, tables, depth}]}
   
   - cancelCrawl(): sets cancelled flag, stops processing queue
   
   - URL normalization: strip hash, trailing slash, normalize protocol
   
   - Respect maxDepth and maxPages limits strictly

2. Wire into background.js command routing:
   - 'crawl.start' → creates CrawlManager, calls startCrawl
   - 'crawl.cancel' → calls cancelCrawl
   - Progress events forwarded through WebSocket as type: 'event'

3. Special handling: if /sitemap.xml found, parse it to seed the queue
```

### Agent 4: VS Code Extension — Tool Registration

```
Build vscode-extension/ as a TypeScript VS Code extension:

1. package.json:
   - engines.vscode: "^1.99.0"
   - activationEvents: ["onStartupFinished"]
   - extensionDependencies: ["github.copilot-chat"]
   - contributes.commands:
     * airbrowse.connect
     * airbrowse.disconnect
     * airbrowse.screenshot
     * airbrowse.crawlCurrentPage
     * airbrowse.selectTool
   - contributes.configuration:
     * airbrowse.relay.port (default 8765)
     * airbrowse.crawl.maxDepth (default 2)
     * airbrowse.crawl.maxPages (default 50)
     * airbrowse.crawl.delayMs (default 1000)
   - contributes.languageModelTools: [all 20+ tools with name, displayName,
     description, inputSchema, tags: ["airbrowse"]]
   - contributes.chatParticipants: [{
       id: "airbrowse.browse",
       fullName: "AirBrowse",
       description: "Browser automation - crawl, extract, test web pages",
       isSticky: true
     }]

2. src/tools/base-tool.ts:
   - Abstract class BaseBrowserTool<T> implements vscode.LanguageModelTool<T>
   - Constructor takes RelayClient
   - Abstract properties: commandName, invocationMessage
   - Default prepareInvocation with confirmation messages
   - invoke() calls this.relayClient.sendCommand(this.commandName, params)
   - Wraps result in LanguageModelToolResult with LanguageModelTextPart

3. src/tools/*.tool.ts:
   - One class per tool, extends BaseBrowserTool
   - Each overrides commandName and any custom invoke logic
   - Example: CrawlSiteTool streams progress via response parts
   - File generation tools (generate-excel, etc.) don't use relay — they 
     generate files directly using ExcelJS/docx and return the file path

4. src/tools/index.ts:
   - registerAllTools(context, relayClient):
     * Instantiates every tool class
     * Calls vscode.lm.registerTool() for each
     * Pushes disposables to context.subscriptions

5. src/extension.ts:
   - activate():
     * Spawn relay server as child process
     * Create RelayClient
     * Wait for connection
     * Call registerAllTools(context, relayClient)
     * Register chat participant
     * Register commands
     * Create status bar item showing connection state
   - deactivate():
     * Kill relay server process
     * Dispose all subscriptions
```

### Agent 5: Chat Participant + Agent Loop

```
Implement the @browse chat participant:

1. src/participant/browse-handler.ts:
   - Export ChatRequestHandler function
   - Detect task type from request.prompt:
     * Contains "crawl" or "scrape" → CRAWL mode
     * Contains "test" + numbered steps → TEST mode
     * Contains "extract" + "table"/"data" → EXTRACT mode
     * Contains "excel"/"xlsx"/"csv"/"word"/"docx" → GENERATE mode
     * Default → QUESTION mode (ask about current page)
   
   - QUESTION mode:
     * Get page content via relay (page.getMarkdown)
     * Select model via vscode.lm.selectChatModels({vendor: 'copilot'})
     * Send content + user question to model
     * Stream response
   
   - CRAWL mode:
     * Execute crawl via relay
     * Stream progress updates
     * When done, chunk content and send to model for summarization
     * Offer file generation buttons
   
   - TEST mode:
     * Parse numbered steps via instruction-parser.ts
     * Execute each step sequentially via relay
     * Capture screenshot after each step
     * For "verify" steps: get page text, ask model if condition is met
     * Stream test report
   
   - EXTRACT mode:
     * Get tables via relay
     * Send to model for cleaning/structuring
     * Offer Excel/CSV export buttons
   
   - GENERATE mode:
     * Combine content from previous steps
     * Generate the requested file type
     * Provide file link in chat

2. src/participant/agent-loop.ts:
   - For complex tasks, run multi-step loop:
     * Build conversation history
     * Instruct model to output JSON action blocks: 
       {"action": "tool_name", "params": {...}}
     * Parse actions from model response
     * Execute via relay
     * Feed results back to conversation
     * Loop until model says "TASK_COMPLETE" or max iterations (15)
   - Context management: truncate old messages when history > 60% 
     of model's maxInputTokens

3. src/participant/instruction-parser.ts:
   - Parse numbered/bulleted test steps
   - Return: {type: 'navigate'|'click'|'type'|'verify'|'wait', 
     target?: string, value?: string, condition?: string}
   - Handle natural language: "Click the Login button" → 
     {type: 'click', target: 'button:contains("Login")'}

4. src/participant/prompts.ts:
   - SYSTEM_PROMPT: Base identity + tool descriptions
   - CRAWL_SUMMARIZE_PROMPT: Instructions for summarizing crawled content
   - DATA_EXTRACT_PROMPT: Instructions for structuring table data
   - UI_TEST_PROMPT: Instructions for evaluating test step results
   - QUESTION_PROMPT: Instructions for answering questions about page content
```

### Agent 6: File Generators

```
Implement file generation in vscode-extension/src/generators/:

1. xlsx.ts:
   - Uses ExcelJS library (npm dependency, bundled in .vsix)
   - generateExcel(data: {sheets: [{name, headers, rows, columnWidths?}]}, 
     outputPath: string): Promise<string>
   - Auto-formatting: bold headers, alternating row colors (#F2F2F2),
     auto-filter on header row, freeze top row, auto-column-width
   - Returns the saved file path
   - Opens file in VS Code after generation

2. docx.ts:
   - Uses docx library (npm dependency, bundled in .vsix)
   - generateWord(data: {title, sections: [{heading, content, level?}]},
     outputPath: string): Promise<string>
   - Professional formatting: Arial font, proper heading styles,
     1-inch margins, page numbers in footer
   - Support for table data sections (rendered as Word tables)

3. csv.ts:
   - Pure TypeScript, no external deps
   - Proper RFC 4180 escaping (quotes, commas, newlines)
   - UTF-8 BOM prefix for Excel compatibility
   - generateCSV(headers: string[], rows: string[][], outputPath): Promise<string>

4. markdown.ts:
   - generateMarkdown(data: {title, content, frontmatter?}): Promise<string>
   - YAML frontmatter with title, date, source URL
   - Clean Markdown with proper heading hierarchy
```

### Agent 7: Polish, Commands & Packaging

```
Final polish and packaging:

1. VS Code commands (bound to command palette):
   - "AirBrowse: Connect to Browser" → start relay + show status
   - "AirBrowse: Take Screenshot" → capture + show in editor
   - "AirBrowse: Extract Current Page" → page.getMarkdown + open in editor
   - "AirBrowse: Quick Crawl" → input box for URL → crawl → show results
   - "AirBrowse: Select Model" → show quickpick of available Copilot models

2. Status bar item:
   - Left side, priority 100
   - Shows: "$(globe) AirBrowse: Connected" or "$(circle-slash) AirBrowse: Disconnected"
   - Click to toggle connection
   - Tooltip shows: current browser page URL, model in use

3. Keybindings:
   - Ctrl+Shift+B (Cmd+Shift+B on mac): Toggle AirBrowse panel
   - No conflicts with existing Copilot bindings

4. scripts/package-all.js:
   - Compile TypeScript
   - Bundle with webpack (single extension.js)
   - Package as .vsix via @vscode/vsce
   - Zip browser-extension/ for Chrome sideloading
   - Output: dist/airbrowse-{version}.vsix + dist/airbrowse-chrome-{version}.zip

5. docs/DEPLOYMENT.md:
   - Prerequisites: VS Code with GitHub Copilot extension (authenticated)
   - Step 1: Install airbrowse .vsix (Extensions → Install from VSIX)
   - Step 2: Load Chrome extension (chrome://extensions → Developer mode → 
     Load unpacked)
   - Step 3: Open any page in Chrome
   - Step 4: In VS Code Copilot Chat, switch to Agent Mode
   - Step 5: Type "read the current page and summarize it"
   - Troubleshooting section for common issues

6. .github/copilot-instructions.md:
   - Project context for developers using Copilot to work on this repo
   - Architecture overview, coding conventions, tool registration pattern
```

---

## 10. Critical Technical Notes

### vscode.lm API Limitations to Handle

1. **No system messages**: The `vscode.lm` API only supports `User` and `Assistant` message roles. System prompts must be sent as the first `User` message.

2. **Consent dialog**: First use of `selectChatModels()` triggers a permission prompt. Must be called from a user-initiated action.

3. **Streaming only**: `sendRequest()` returns `AsyncIterable<string>` — always streaming. Collect fragments for full response.

4. **Rate limits**: VS Code tracks per-extension model usage. Our extension should be mindful and batch operations where possible.

5. **Model availability**: The user's Copilot plan determines available models. Always handle `models.length === 0` gracefully.

6. **maxInputTokens**: Each model has a token limit (GPT-4o: 128K). The `model.maxInputTokens` property tells us. Chunk accordingly.

### Enterprise Deployment Checklist

- [ ] Copilot license assigned to user (Business or Enterprise plan)
- [ ] Copilot endpoints allowlisted in firewall/proxy
- [ ] VS Code installed with Copilot + Copilot Chat extensions
- [ ] AirBrowse .vsix installed in VS Code
- [ ] AirBrowse Chrome extension loaded (unpacked or .crx)
- [ ] Chrome can reach intranet sites
- [ ] User has authenticated Copilot in VS Code (one-time)

---

## 11. Timeline Estimate

| Phase | Duration | Deliverable |
|---|---|---|
| Agent 1: Scaffolding + Relay | 1 day | Working relay server |
| Agent 2: Chrome Extension Core | 2 days | 15+ browser tools |
| Agent 3: Crawl Engine | 1 day | Multi-page crawling |
| Agent 4: VS Code Tools Registration | 2 days | All tools in Agent Mode |
| Agent 5: Chat Participant + Agent Loop | 2 days | @browse with multi-step |
| Agent 6: File Generators | 1 day | XLSX, DOCX, CSV output |
| Agent 7: Polish + Packaging | 1 day | Deployable .vsix + .zip |
| Testing & Iteration | 2-3 days | Stable release |
| **Total** | **~12-14 days** | **v1.0** |

---

## 12. Getting Started

```bash
mkdir airbrowse && cd airbrowse && git init
claude  # Start Claude Code, paste Agent 1's prompt
```

Work through agents 1→7 sequentially. Each builds on the previous. The `.github/copilot-instructions.md` file helps Claude Code maintain context across sessions.

---

*Every agent prompt above is designed to be pasted directly into Claude Code as a complete task. The extension uses ZERO custom AI infrastructure — only GitHub Copilot's existing authenticated models via the native vscode.lm API.*
