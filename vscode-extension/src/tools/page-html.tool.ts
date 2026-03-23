import { BaseBrowserTool } from './base-tool';

interface PageHtmlInput {
  selector?: string;
  outer?: boolean;
}

export class PageHtmlTool extends BaseBrowserTool<PageHtmlInput> {
  readonly commandName = 'page.getHTML';
  readonly invocationMessage = 'Getting page HTML...';
}
