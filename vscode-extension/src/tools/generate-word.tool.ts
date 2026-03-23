import * as vscode from 'vscode';
import { BaseBrowserTool } from './base-tool';

interface DocSection {
  heading: string;
  content: string;
  level?: number;
  table?: { headers: string[]; rows: string[][] };
}

interface GenerateWordInput {
  title: string;
  sections: DocSection[];
  filename?: string;
}

export class GenerateWordTool extends BaseBrowserTool<GenerateWordInput> {
  readonly commandName = 'generate.word';
  readonly invocationMessage = 'Generating Word document...';

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GenerateWordInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { generateWord } = await import('../generators/docx');
      const filePath = await generateWord(options.input);

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
