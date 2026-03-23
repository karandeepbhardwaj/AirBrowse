import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function generateMarkdownFile(
  data: { title: string; content: string; sourceUrl?: string; filename?: string; frontmatter?: Record<string, string> },
  outputDir?: string
): Promise<string> {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`title: "${data.title}"`);
  lines.push(`date: "${new Date().toISOString()}"`);
  lines.push(`generator: "AirBrowse"`);
  if (data.sourceUrl) {
    lines.push(`source: "${data.sourceUrl}"`);
  }
  if (data.frontmatter) {
    for (const [key, value] of Object.entries(data.frontmatter)) {
      lines.push(`${key}: "${value}"`);
    }
  }
  lines.push('---');
  lines.push('');
  lines.push(`# ${data.title}`);
  lines.push('');
  lines.push(data.content);

  const dir = outputDir ?? getOutputDir();
  const filename = data.filename ?? `airbrowse-${data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');

  const uri = vscode.Uri.file(filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);

  return filePath;
}

function getOutputDir(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri.fsPath;
  }
  return require('os').homedir();
}
