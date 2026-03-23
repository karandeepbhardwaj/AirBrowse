import { BaseBrowserTool } from './base-tool';

interface PageLinksInput {
  selector?: string;
  includeExternal?: boolean;
}

export class PageLinksTool extends BaseBrowserTool<PageLinksInput> {
  readonly commandName = 'page.getLinks';
  readonly invocationMessage = 'Getting page links...';
}
