import { BaseBrowserTool } from './base-tool';

interface PageTextInput {
  selector?: string;
}

export class PageTextTool extends BaseBrowserTool<PageTextInput> {
  readonly commandName = 'page.getText';
  readonly invocationMessage = 'Reading page text...';
}
