# AirBrowse - Enterprise Deployment Guide

## Prerequisites

- **GitHub Copilot Business or Enterprise** license for all users
- **VS Code** 1.99+ deployed to workstations
- **Network access** to GitHub Copilot endpoints (see [GitHub docs](https://docs.github.com/en/copilot/troubleshooting-github-copilot/troubleshooting-network-errors-for-github-copilot))
- No additional AI API keys or external services required

## Installing the VS Code Extension

### Build the .vsix

```bash
git clone https://github.com/your-org/airbrowse.git
cd airbrowse
npm install
npm run package
```

The `.vsix` file will be in `dist/`.

### Install via CLI

```bash
code --install-extension dist/airbrowse-0.1.0.vsix
```

### Install via VS Code UI

1. Open VS Code
2. Go to Extensions view (Ctrl+Shift+X)
3. Click the `...` menu at the top of the Extensions panel
4. Select **Install from VSIX...**
5. Select the `.vsix` file from `dist/`

### Deploy via Policy (IT-managed)

Use VS Code's `extensions.json` or your MDM solution to push the `.vsix` to managed workstations.

## Loading the Chrome Extension

### For Individual Users

1. Unzip `dist/airbrowse-chrome.zip` to a permanent directory
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** and select the unzipped directory

### For Managed Chrome (Enterprise)

Use Chrome Enterprise policies to force-install the extension:

```json
{
  "ExtensionInstallForcelist": [
    "your-extension-id;https://your-update-server/updates.xml"
  ]
}
```

Or publish to a private Chrome Web Store collection.

## Network Configuration

AirBrowse communicates entirely on localhost. No firewall rules are needed for the relay itself.

### Ports

| Port | Protocol | Purpose |
|------|----------|---------|
| 8765 | WebSocket (ws://) | VS Code to Chrome relay |

The relay binds to `127.0.0.1` only -- it does not accept remote connections.

### Required External Access

AirBrowse uses GitHub Copilot for AI, so the standard Copilot endpoints must be reachable:

- `https://api.github.com`
- `https://copilot-proxy.githubusercontent.com`
- `https://*.githubcopilot.com`

No other external AI services are contacted.

## Troubleshooting

### Relay port conflict

If port 8765 is already in use:

```bash
# Check what's using the port
lsof -i :8765

# Configure a different port in VS Code settings
# Settings > airbrowse.relayPort
```

Both the VS Code extension and Chrome extension must use the same port.

### Copilot authentication

- Ensure the user is signed into GitHub in VS Code
- Verify Copilot subscription is active: open Copilot Chat and check for errors
- If behind a proxy, configure `http.proxy` in VS Code settings

### Extension not loading

- Check the VS Code Output panel (select "AirBrowse" from the dropdown)
- Verify `github.copilot-chat` is installed (it's a required dependency)
- Try `Developer: Reload Window` from the Command Palette

### Chrome extension issues

- Ensure the extension is enabled in `chrome://extensions`
- Click "Errors" on the extension card to see console errors
- Check that no other extension is conflicting with content script injection
