import { BaseBrowserTool } from './base-tool';

type GetUrlInput = Record<string, never>;

export class GetUrlTool extends BaseBrowserTool<GetUrlInput> {
  readonly commandName = 'page.getCurrentUrl';
  readonly invocationMessage = 'Getting current URL...';
}
