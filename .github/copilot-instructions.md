# AirBrowse - Copilot Instructions

## Architecture

- VS Code extension + Chrome extension for browser automation
- Uses GitHub Copilot's `vscode.lm` API -- no custom AI infrastructure
- WebSocket relay on `localhost:8765` bridges VS Code and Chrome
- Two integration paths: Language Model Tools (Agent Mode) and `@browse` Chat Participant

## Key Patterns

- Tools extend `BaseBrowserTool` in `src/tools/`
- Chrome extension `content.js` handles DOM operations
- Relay server routes commands between VS Code and Chrome
- File generators (xlsx, docx, csv, md) live in `src/generators/`

## Code Structure

```
vscode-extension/
  src/
    tools/          # One tool per file, extends BaseBrowserTool
    generators/     # File output generators (xlsx, docx, csv, md)
    relay/          # WebSocket relay client
  relay/            # WebSocket relay server (standalone)
browser-extension/
  manifest.json     # Chrome MV3 manifest
  background.js     # Service worker
  content.js        # DOM interaction layer
  crawl-manager.js  # Multi-page crawl engine
  popup/            # Extension popup UI
```

## Conventions

- TypeScript strict mode throughout the VS Code extension
- One tool per file in `src/tools/`, named `<action>.tool.ts`
- All browser commands go through `RelayClient.sendCommand()`
- No external AI APIs -- only `vscode.lm.selectChatModels({ vendor: 'copilot' })`
- The relay server is plain Node.js (no TypeScript) for minimal startup time

## Tool Pattern

Every tool file exports a class extending `BaseBrowserTool`:

```typescript
export class MyTool extends BaseBrowserTool {
  name = 'my_tool';
  description = 'What this tool does';
  inputSchema = { /* JSON Schema */ };

  async execute(input: ToolInput): Promise<ToolResult> {
    const result = await this.relay.sendCommand('commandName', input);
    return { content: result };
  }
}
```

## Relay Protocol

Commands flow as JSON over WebSocket:

```
VS Code  --[sendCommand]--> Relay Server --[forward]--> Chrome Extension
VS Code  <--[response]----  Relay Server <--[result]---  Chrome Extension
```

Each command has a unique `id`, a `type` string, and a `payload` object.

## Testing

- Run the extension in VS Code's Extension Development Host (F5)
- Load the Chrome extension in `chrome://extensions` with Developer Mode
- Test with `@browse summarize this page` or Agent Mode tools
