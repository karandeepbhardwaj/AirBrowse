import { BaseBrowserTool } from './base-tool';

interface PageMarkdownInput {
  selector?: string;
  includeLinks?: boolean;
}

export class PageMarkdownTool extends BaseBrowserTool<PageMarkdownInput> {
  readonly commandName = 'page.getMarkdown';
  readonly invocationMessage = 'Converting page to Markdown...';
}
