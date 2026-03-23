import { BaseBrowserTool } from './base-tool';

interface ClickInput {
  selector: string;
}

export class ClickTool extends BaseBrowserTool<ClickInput> {
  readonly commandName = 'interact.click';
  readonly invocationMessage = 'Clicking element...';
}
