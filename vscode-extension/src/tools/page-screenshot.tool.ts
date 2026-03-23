import * as vscode from 'vscode';
import { BaseBrowserTool } from './base-tool';

interface PageScreenshotInput {
  selector?: string;
  fullPage?: boolean;
}

export class PageScreenshotTool extends BaseBrowserTool<PageScreenshotInput> {
  readonly commandName = 'page.screenshot';
  readonly invocationMessage = 'Taking screenshot...';

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<PageScreenshotInput>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    if (!this.relay.isBrowserConnected) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          'Error: No browser connected. Please ensure Chrome is running with the AirBrowse extension.'
        ),
      ]);
    }

    try {
      const result = await this.relay.sendCommand(
        this.commandName,
        options.input as Record<string, unknown>
      );
      const data = result as { base64?: string; mimeType?: string };
      const base64 = data.base64 ?? '';
      const mimeType = data.mimeType ?? 'image/png';

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Screenshot captured (${mimeType}, ${Math.round(base64.length * 0.75 / 1024)} KB):\ndata:${mimeType};base64,${base64}`
        ),
      ]);
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        ),
      ]);
    }
  }
}
