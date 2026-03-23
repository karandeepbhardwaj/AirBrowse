import * as vscode from 'vscode';
import { BaseBrowserTool } from './base-tool';

interface GenerateMarkdownInput {
  title: string;
  content: string;
  sourceUrl?: string;
  filename?: string;
  frontmatter?: Record<string, string>;
}

export class GenerateMarkdownTool extends BaseBrowserTool<GenerateMarkdownInput> {
  readonly commandName = 'generate.markdown';
  readonly invocationMessage = 'Generating Markdown file...';

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<GenerateMarkdownInput>,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { generateMarkdownFile } = await import('../generators/markdown');
      const filePath = await generateMarkdownFile(options.input);

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
