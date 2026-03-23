import * as vscode from 'vscode';
import { BaseBrowserTool } from './base-tool';

interface SheetData {
  name: string;
  headers: string[];
  rows: (string | number | boolean)[][];
  columnWidths?: number[];
}

interface GenerateExcelInput {
  sheets: SheetData[];
  filename?: string;
}

export class GenerateExcelTool extends BaseBrowserTool<GenerateExcelInput> {
  readonly commandName = 'generate.excel';
  readonly invocationMessage = 'Generating Excel file...';

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GenerateExcelInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { generateExcel } = await import('../generators/xlsx');
      const filePath = await generateExcel(options.input);

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
