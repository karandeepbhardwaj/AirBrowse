# AirBrowse - Setup Guide

## Prerequisites

- **VS Code** 1.99 or later
- **GitHub Copilot** extension (with an active Copilot subscription)
- **GitHub Copilot Chat** extension
- **Google Chrome** (or Chromium-based browser)
- **Node.js** 18+ and npm

## Development Setup

### 1. Clone and Install

```bash
git clone https://github.com/your-org/airbrowse.git
cd airbrowse
npm install
```

This installs dependencies for both the VS Code extension and the browser extension (npm workspaces).

### 2. Build the VS Code Extension

```bash
npm run build
```

This compiles TypeScript and bundles with webpack.

### 3. Load the Chrome Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked**
4. Select the `browser-extension/` directory from this repo

The AirBrowse icon should appear in your Chrome toolbar.

### 4. Run the VS Code Extension

1. Open the `vscode-extension/` folder in VS Code
2. Press **F5** to launch the Extension Development Host
3. In the new VS Code window, open the Command Palette and run **AirBrowse: Connect to Browser**

### 5. Test It Out

**Chat Participant mode:**
- Open Copilot Chat in VS Code
- Type `@browse summarize this page`

**Agent Mode:**
- Open Copilot Chat and switch to Agent Mode
- Ask: "Navigate to example.com and get the page title"
- Copilot will use AirBrowse tools automatically

## Configuration

AirBrowse settings are available in VS Code Settings under `airbrowse.*`:

| Setting | Default | Description |
|---------|---------|-------------|
| `airbrowse.relayPort` | `8765` | WebSocket relay port |
| `airbrowse.autoConnect` | `true` | Connect to browser on startup |

## Troubleshooting

### Extension not activating
- Ensure GitHub Copilot Chat is installed and signed in
- Check VS Code version is 1.99+

### Cannot connect to browser
- Verify the Chrome extension is loaded and enabled
- Check that port 8765 is not in use: `lsof -i :8765`
- Try reloading both the Chrome extension and VS Code extension

### No tools appearing in Agent Mode
- Make sure you're using VS Code 1.99+ (Language Model Tools API)
- Restart the Extension Development Host
- Check the Output panel for "AirBrowse" logs
