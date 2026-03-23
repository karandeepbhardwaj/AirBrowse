import * as vscode from 'vscode';
import { BaseBrowserTool } from './base-tool';

interface GenerateCsvInput {
  headers: string[];
  rows: string[][];
  filename?: string;
}

export class GenerateCsvTool extends BaseBrowserTool<GenerateCsvInput> {
  readonly commandName = 'generate.csv';
  readonly invocationMessage = 'Generating CSV file...';

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GenerateCsvInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { generateCSV } = await import('../generators/csv');
      const filePath = await generateCSV(options.input);

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(`File created at: ${filePath}`),
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
