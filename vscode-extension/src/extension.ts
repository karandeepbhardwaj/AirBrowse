import * as vscode from 'vscode';
import { RelayClient } from './relay/client';
import { registerAllTools } from './tools';
import { registerBrowseParticipant } from './participant/browse-handler';
import { log, logError } from './utils/logger';

let relayClient: RelayClient;

export async function activate(context: vscode.ExtensionContext) {
  log('AirBrowse activating...');

  const config = vscode.workspace.getConfiguration('airbrowse');
  const port = config.get<number>('relay.port', 8765);

  relayClient = new RelayClient(port);

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBar.command = 'airbrowse.connect';
  updateStatusBar(statusBar, false, false);
  statusBar.show();
  context.subscriptions.push(statusBar);

  // Connection state tracking
  relayClient.on('connected', () =>
    updateStatusBar(statusBar, true, relayClient.isBrowserConnected)
  );
  relayClient.on('disconnected', () => updateStatusBar(statusBar, false, false));
  relayClient.on('browserConnected', () =>
    updateStatusBar(statusBar, true, true)
  );
  relayClient.on('browserDisconnected', () =>
    updateStatusBar(statusBar, true, false)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('airbrowse.connect', async () => {
      try {
        await relayClient.startRelay(context.extensionPath);
        vscode.window.showInformationMessage(
          'AirBrowse: Connected to relay server'
        );
      } catch (err) {
        logError('Failed to start relay', err);
        vscode.window.showErrorMessage(`AirBrowse: Failed to connect - ${err}`);
      }
    }),
    vscode.commands.registerCommand('airbrowse.disconnect', () => {
      relayClient.dispose();
      updateStatusBar(statusBar, false, false);
    }),
    vscode.commands.registerCommand('airbrowse.screenshot', async () => {
      if (!relayClient.isBrowserConnected) {
        vscode.window.showWarningMessage('AirBrowse: No browser connected');
        return;
      }
      const result = await relayClient.sendCommand('page.screenshot', {});
      vscode.window.showInformationMessage('Screenshot captured');
    }),
    vscode.commands.registerCommand('airbrowse.extractPage', async () => {
      if (!relayClient.isBrowserConnected) {
        vscode.window.showWarningMessage('AirBrowse: No browser connected');
        return;
      }
      const result = (await relayClient.sendCommand('page.getMarkdown', {})) as {
        markdown?: string;
      };
      const doc = await vscode.workspace.openTextDocument({
        content: result.markdown ?? '',
        language: 'markdown',
      });
      await vscode.window.showTextDocument(doc);
    }),
    vscode.commands.registerCommand('airbrowse.quickCrawl', async () => {
      const url = await vscode.window.showInputBox({
        prompt: 'Enter URL to crawl',
        placeHolder: 'https://...',
      });
      if (!url) {
        return;
      }
      vscode.window.showInformationMessage(
        `AirBrowse: Starting crawl of ${url}`
      );
      const result = (await relayClient.sendCommand('crawl.start', {
        startUrl: url,
        maxDepth: config.get('crawl.maxDepth', 2),
        maxPages: config.get('crawl.maxPages', 50),
      })) as { pages?: unknown[] };
      vscode.window.showInformationMessage(
        `Crawl complete: ${result.pages?.length ?? 0} pages`
      );
    })
  );

  // Register tools
  registerAllTools(context, relayClient);

  // Register chat participant
  registerBrowseParticipant(context, relayClient);

  // Auto-connect
  try {
    await relayClient.startRelay(context.extensionPath);
    log('Relay server started');
  } catch (err) {
    logError('Auto-connect failed', err);
  }

  log('AirBrowse activated');
}

function updateStatusBar(
  item: vscode.StatusBarItem,
  relayConnected: boolean,
  browserConnected: boolean
) {
  if (browserConnected) {
    item.text = '$(globe) AirBrowse: Connected';
    item.tooltip = 'Browser connected - Click to manage';
    item.backgroundColor = undefined;
  } else if (relayConnected) {
    item.text = '$(globe) AirBrowse: Waiting for Browser';
    item.tooltip = 'Relay running, waiting for Chrome extension';
    item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.warningBackground'
    );
  } else {
    item.text = '$(circle-slash) AirBrowse: Disconnected';
    item.tooltip = 'Click to connect';
    item.backgroundColor = undefined;
  }
}

export function deactivate() {
  relayClient?.dispose();
}
