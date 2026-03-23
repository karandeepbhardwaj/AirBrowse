import * as vscode from 'vscode';
import { RelayClient } from '../relay/client';

export abstract class BaseBrowserTool<T = Record<string, unknown>> implements vscode.LanguageModelTool<T> {
  constructor(protected readonly relay: RelayClient) {}

  abstract readonly commandName: string;
  abstract readonly invocationMessage: string;

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<T>,
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
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
      ]);
    } catch (err) {
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Error: ${err instanceof Error ? err.message : String(err)}`
        ),
      ]);
    }
  }

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<T>,
    token: vscode.CancellationToken
  ): Promise<vscode.PreparedToolInvocation> {
    return {
      invocationMessage: this.invocationMessage,
    };
  }
}
