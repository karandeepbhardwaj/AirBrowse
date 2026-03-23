import { BaseBrowserTool } from './base-tool';

type CrawlCancelInput = Record<string, never>;

export class CrawlCancelTool extends BaseBrowserTool<CrawlCancelInput> {
  readonly commandName = 'crawl.cancel';
  readonly invocationMessage = 'Cancelling crawl...';
}
