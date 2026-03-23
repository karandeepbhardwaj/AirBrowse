import * as vscode from 'vscode';
import { BaseBrowserTool } from './base-tool';
import { RelayClient } from '../relay/client';

interface CrawlSiteInput {
  startUrl: string;
  maxDepth?: number;
  maxPages?: number;
  pattern?: string;
}

export class CrawlSiteTool extends BaseBrowserTool<CrawlSiteInput> {
  readonly commandName = 'crawl.start';
  readonly invocationMessage = 'Starting site crawl...';

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<CrawlSiteInput>,
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
      const progressMessages: string[] = [];

      const progressHandler = (data: unknown) => {
        const progress = data as { pagesVisited?: number; currentUrl?: string; totalFound?: number };
        progressMessages.push(
          `Visited ${progress.pagesVisited ?? '?'} pages, current: ${progress.currentUrl ?? 'unknown'}`
        );
      };

      this.relay.on('crawl.progress', progressHandler);

      const onCancel = token.onCancellationRequested(() => {
        this.relay.sendCommand('crawl.cancel', {}).catch(() => {});
      });

      try {
        const result = await this.relay.sendCommand(
          this.commandName,
          options.input as unknown as Record<string, unknown>
        );

        const output = [
          JSON.stringify(result, null, 2),
        ];

        if (progressMessages.length > 0) {
          output.push('\n--- Crawl Progress ---');
          output.push(progressMessages.join('\n'));
        }

        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(output.join('\n')),
        ]);
      } finally {
        this.relay.removeListener('crawl.progress', progressHandler);
        onCancel.dispose();
      }
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        ),
      ]);
    }
  }
}
