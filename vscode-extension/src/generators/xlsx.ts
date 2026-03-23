import * as vscode from 'vscode';
import * as path from 'path';
import ExcelJS from 'exceljs';

interface SheetData {
  name: string;
  headers: string[];
  rows: (string | number | boolean)[][];
  columnWidths?: number[];
}

export async function generateExcel(
  data: { sheets: SheetData[]; filename?: string },
  outputDir?: string
): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'AirBrowse';
  workbook.created = new Date();

  for (const sheet of data.sheets) {
    const ws = workbook.addWorksheet(sheet.name);

    // Headers - bold, with background color
    ws.addRow(sheet.headers);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF007ACC' }
    };
    headerRow.alignment = { vertical: 'middle' };

    // Data rows
    for (const row of sheet.rows) {
      ws.addRow(row);
    }

    // Auto-filter
    ws.autoFilter = { from: 'A1', to: `${String.fromCharCode(64 + sheet.headers.length)}1` };

    // Freeze top row
    ws.views = [{ state: 'frozen', ySplit: 1 }];

    // Auto column width (or use provided widths)
    ws.columns.forEach((col, i) => {
      if (sheet.columnWidths?.[i]) {
        col.width = sheet.columnWidths[i];
      } else {
        // Auto-width: max of header length and longest data value
        const maxLen = Math.max(
          sheet.headers[i]?.length ?? 10,
          ...sheet.rows.map(r => String(r[i] ?? '').length)
        );
        col.width = Math.min(Math.max(maxLen + 2, 10), 50);
      }
    });
  }

  // Determine output path
  const dir = outputDir ?? getOutputDir();
  const filename = data.filename ?? `airbrowse-export-${Date.now()}.xlsx`;
  const filePath = path.join(dir, filename);

  await workbook.xlsx.writeFile(filePath);

  // Open in VS Code
  const uri = vscode.Uri.file(filePath);
  await vscode.commands.executeCommand('vscode.open', uri);

  return filePath;
}

function getOutputDir(): string {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    return workspaceFolders[0].uri.fsPath;
  }
  return require('os').homedir();
}
