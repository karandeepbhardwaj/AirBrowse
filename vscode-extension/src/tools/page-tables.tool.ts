import { BaseBrowserTool } from './base-tool';

interface PageTablesInput {
  selector?: string;
  format?: 'json' | 'csv' | 'markdown';
}

export class PageTablesTool extends BaseBrowserTool<PageTablesInput> {
  readonly commandName = 'page.getTables';
  readonly invocationMessage = 'Extracting tables...';
}
