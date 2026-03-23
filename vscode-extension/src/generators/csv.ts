import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export async function generateCSV(
  data: { headers: string[]; rows: string[][]; filename?: string },
  outputDir?: string
): Promise<string> {
  const BOM = '\uFEFF'; // UTF-8 BOM for Excel

  const escapeField = (field: string): string => {
    const str = String(field ?? '');
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [];
  lines.push(data.headers.map(escapeField).join(','));
  for (const row of data.rows) {
    lines.push(row.map(escapeField).join(','));
  }

  const dir = outputDir ?? getOutputDir();
  const filename = data.filename ?? `airbrowse-export-${Date.now()}.csv`;
  const filePath = path.join(dir, filename);

  fs.writeFileSync(filePath, BOM + lines.join('\r\n'), 'utf-8');

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
