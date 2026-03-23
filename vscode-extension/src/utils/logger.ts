import * as vscode from 'vscode';

let outputChannel: vscode.OutputChannel | undefined;

export function getLogger(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('AirBrowse');
  }
  return outputChannel;
}

export function log(message: string): void {
  const timestamp = new Date().toISOString();
  getLogger().appendLine(`[${timestamp}] ${message}`);
}

export function logError(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  const errorStr = error instanceof Error ? error.message : String(error ?? '');
  getLogger().appendLine(`[${timestamp}] ERROR: ${message} ${errorStr}`);
}
